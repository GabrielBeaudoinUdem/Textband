import torch
import argparse
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from transformers import pipeline, AutoModelForSpeechSeq2Seq, AutoTokenizer, AutoFeatureExtractor
import time
import librosa
import os
import tempfile
import uvicorn
from pydantic import BaseModel
from llm_phonetic import get_contextual_synonyms
from gruut import sentences
from phonetic_utils import split_phonemes, matches_constraints

app = FastAPI(title="TextBand Transcription & Phonetics Server")

# Allow CORS for Next.js frontend if needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables for the model
pipe = None

def init_whisper_model(model_id="openai/whisper-large-v3", local_files_only=False):
    global pipe
    print(f"--- Initialisation du modèle Whisper ({model_id}) ---")
    
    # Détection du device Apple Silicon
    if torch.backends.mps.is_available():
        device = "mps"
        print("Utilisation du device: mps (accélération Apple Silicon)")
    else:
        device = "cpu"
        print("Utilisation du device: cpu")

    # La conversion float16 cause souvent l'erreur "out of range integral type conversion"
    # sur Apple Silicon (mps) avec les grands modèles Whisper (large-v3). 
    # On force float32 pour contourner le bug MPS :
    torch_dtype = torch.float32

    try:
        model = AutoModelForSpeechSeq2Seq.from_pretrained(
            model_id, torch_dtype=torch_dtype, low_cpu_mem_usage=True, use_safetensors=True,
            local_files_only=local_files_only
        )
        model.to(device)
        tokenizer = AutoTokenizer.from_pretrained(model_id, local_files_only=local_files_only)
        feature_extractor = AutoFeatureExtractor.from_pretrained(model_id, local_files_only=local_files_only)
        
        print("Modèle, tokenizer et feature extractor chargés avec succès.")

        pipe = pipeline(
            "automatic-speech-recognition",
            model=model, tokenizer=tokenizer, feature_extractor=feature_extractor,
            device=device
        )
        print("Pipeline prêt!")
    except Exception as e:
        print(f"\n--- ERREUR LORS DU CHARGEMENT DU MODÈLE ---")
        if local_files_only:
            print("Impossible de trouver le modèle en local. Démarrez sans --local-only.")
        print(f"Détail de l'erreur : {e}")
        raise e

@app.on_event("startup")
def startup_event():
    # Load model on startup!
    # Using the large model for better accuracy.
    init_whisper_model("openai/whisper-large-v3", local_files_only=False)

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...), language: str = "english"):
    if pipe is None:
        raise HTTPException(status_code=500, detail="Le modèle n'est pas chargé.")

    print(f"--- Réception du fichier audio: {file.filename}, langue: {language} ---")
    
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
            content = await file.read()
            temp_audio.write(content)
            temp_audio_path = temp_audio.name
        audio_array, sampling_rate = librosa.load(temp_audio_path, sr=16000)
        os.unlink(temp_audio_path)
    except Exception as e:
        print(f"Erreur de lecture audio : {e}")
        raise HTTPException(status_code=400, detail=f"Erreur lors de la lecture de l'audio: {str(e)}")

    print(f"\n--- Transcription en cours ({language}) ---")
    start_time = time.time()

    try:
        # Pass the requested language to the model
        resultat = pipe(audio_array, generate_kwargs={"language": language}, return_timestamps=False)
    except Exception as e:
        print(f"Erreur de transcription : {e}")
        raise HTTPException(status_code=500, detail=f"Erreur de transcription: {str(e)}")

    end_time = time.time()
    duree = end_time - start_time
    final_text = resultat['text'].strip()

    print("\n--- Résultat ---")
    print(final_text)
    print(f"Opération terminée en {duree:.2f} secondes.")

    return {"text": final_text, "duration": duree}



class PhonemizeRequest(BaseModel):
    text: str
    language: str

@app.post("/api/phonemize")
async def phonemize_text(req: PhonemizeRequest):
    # gruut uses specific language codes
    lang_code = "en-us" if req.language == "en" else "fr-fr"
    
    print(f"--- Phonémisation ({req.language}): {req.text} ---")
    
    try:
        words_data = []
        for sentence in sentences(req.text, lang=lang_code):
            for word in sentence.words:
                # word.phonemes can be a list of objects or strings
                phonemes = []
                for p in word.phonemes:
                    if hasattr(p, "text"):
                        phonemes.append(p.text)
                    else:
                        phonemes.append(str(p))
                
                if phonemes:
                    words_data.append({
                        "text": word.text,
                        "phonemes": phonemes
                    })
        print(f"Resultat: {words_data}")
        return {"words": words_data}
    except Exception as e:
        print(f"Erreur de phonémisation : {e}")
        raise HTTPException(status_code=500, detail=str(e))


class SynonymBankRequest(BaseModel):
    text: str
    language: str = "en"

@app.post("/api/synonym-bank")
async def get_synonym_bank(req: SynonymBankRequest):
    lang_code = "en-us" if req.language == "en" else "fr-fr"
    bank = []
    
    # 1. Phonemize original sentence to get word list
    try:
        # Use lowercased text for gruut tokenization (gruut splits uppercase words per-character)
        lowered_text = req.text.lower()
        original_words_lower = []
        for s in sentences(lowered_text, lang=lang_code):
            for w in s.words:
                original_words_lower.append(w.text)
        
        # Map back to original casing from the input text
        original_words = []
        search_idx = 0
        for lw in original_words_lower:
            pos = req.text.lower().find(lw, search_idx)
            if pos != -1:
                original_words.append(req.text[pos:pos+len(lw)])
                search_idx = pos + len(lw)
            else:
                original_words.append(lw)
        
        # 2. For each word, get synonyms and their segments
        for word in original_words:
            # Skip very short or common words if needed, but for now do all
            syns = get_contextual_synonyms(req.text, word, req.language)
            # Filter multi-word results and ensure uniqueness
            seen_syns = set()
            unique_syns = []
            
            # Add original word first if it's not already in the list
            word_clean = word.strip()
            unique_syns.append(word_clean)
            seen_syns.add(word_clean.lower())
            
            for s in syns:
                s_clean = s.strip()
                if ' ' not in s_clean and s_clean.lower() not in seen_syns:
                    unique_syns.append(s_clean)
                    seen_syns.add(s_clean.lower())
            
            syn_data = []
            for s_text in unique_syns:
                # Phonemize synonym (use lowercase for gruut)
                s_phonemes = []
                for sent in sentences(s_text.lower(), lang=lang_code):
                    for w in sent.words:
                        s_phonemes.extend([getattr(p, "text", str(p)) for p in w.phonemes])
                
                syn_data.append({
                    "text": s_text,
                    "segments": split_phonemes(s_phonemes)
                })
            
            bank.append({
                "original": word,
                "synonyms": syn_data
            })
            
        return {"synonym_bank": bank}
    except Exception as e:
        print(f"Error in synonym-bank: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Serveur Whisper avec FastAPI")
    parser.add_argument("--port", type=int, default=8000, help="Port pour le serveur FastAPI")
    args = parser.parse_args()
    
    uvicorn.run("server:app", host="0.0.0.0", port=args.port, reload=False)
