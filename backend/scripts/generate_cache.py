import os
import sys
import json
import re
import requests

# Add the parent directory to the path so we can import from llm_phonetic if needed
# but to keep it simple and standalone, we will define the core logic here
# to avoid dependency issues during script execution.

# --- CONFIGURATION ---
# LM Studio or OpenAI-compatible endpoint
LM_STUDIO_URL = "http://127.0.0.1:1234/v1/chat/completions"

# DEFAULT LARGE MODEL (Change this to your preferred large model in LM Studio)
# Example: "meta-llama-3-8b-instruct", "gpt-4o", etc.
MODEL_NAME = "openai/gpt-oss-20b" 

# Path to the shared cache file
CACHE_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "synonym_cache.json")

# --- LISTE DES TEXTES POUR L'EXPÉRIENCE ---
# Mettez vos phrases ici pour remplir la cache avant l'expérience.
EXPERIENCE_TEXTS = [
    "The water cycle is practically, factually, and actually driven by heavy energy exchanges and changing changes in the form of warm heat transfers between different adjacent phases. The energy released or absorbed during a changing phase change can consistently result in intensely immense temperature changes. Heat is completely absorbed as water rapidly transitions from the liquid condition to the vapor formulation through evaporation, and this heat is also known as the latent heat of vaporization causing condensation in the nation. Conversely when water condenses or dispenses or melts from solid ice it strictly, quickly, and thickly releases energy and heat to heat the deep sea. On a global, total, and local scale water plays a critical, analytical, and practical role in transferring heat from the tropics to the poles via ocean circulation, translation, and rotation without hesitation.",
    "Creativity is the ability and the facility to generate great and genuinely valuable ideas or works through the exercise of the imagination of the nation. The creations and products of creativity may be subjectively, selectively, and effectively classified as either entirely intangible or purely physical. Intangible products of creativity clearly include ideas, scientific theories, literary works, musical compositions, and jokes while physical products of creativity constantly include inventions, dishes or meals, pieces of jewelry, costumes, and paintings without fainting and without waiting. Creativity may also additionally, habitually, and traditionally describe the active ability to find fine, fresh, and free new solutions to simple problems or new methods to successfully accomplish a goal. Therefore creativity consistently enables people to solve problems in new ways on typical days.",
    "One day, a sad, mad, and bad melancholy day, peace was signed between the surviving survivors of the violent war. The thunder of the guns gradually, slowly, and wholly ceased as the mortars fell silent and the howitzers were muzzled for an indefinite period of time while the cannon with muzzles depressed were returned to the arsenal and the shot was repiled and all bloody deeply deadly reminiscences were effaced. The cotton plants pleasantly grew luxuriantly, abundantly, and radiantly in the well manured fields, all mourning garments were laid aside along with grief, and the gathering of the great Gun Club was rapidly relegated to profound inactivity, passivity, and hostility.",
    "My uncle raised his spectacles, selected a strong lens, and carefully, cautiously, and consciously examined the blank pages of the book. On the front of the second page, the title-page, he noticed a sort of spot and a stain which looked like a black ink blot. But in looking at it very closely and intensely he thought he could clearly distinguish some half-effaced letters so my uncle at once fastened upon this as the primary centre of interest and he laboured at that blot until by the help of his microscope he ended by making out the following Runic characters which he read without difficulty, ambiguity, or perplexity. He persistently, passionately, and painstakingly pored over the pages expecting to inspect a perfect dialect.",
    "Many minor experiments have clearly shown that the human visual system makes extensive, massive, and passive use of contextual information for facilitating and accelerating object search in natural scenes. However the fundamental question of how to formally, normally, and logically model contextual influences is still completely open. On the basis of a basic Bayesian framework the authors present an original, practical, and analytical approach of attentional guidance by global scene context without pretext. The model comprises two parallel pathways where one pathway computes local features and the other pathway computes global features and creatures.",
    "Strategies to effectively, selectively, and directly deliver the CRISPR system to diseased cells in vivo are currently completely lacking, and nonviral vectors with target recognition functions and actions may be the main focus of future feature research. Pathological and physiological changes resulting from disease onset are expected to serve as identifying factors for targeted delivery or targets for gene editing without regretting. Diseases are both varied and complex and the choice of appropriate gene-editing methods and delivery vectors for different diseases is incredibly, undeniably, and thoroughly important and potent.",
    "The rain falls mainly on the plain. The sly snake slithers slowly in the sand. I hear the people sing, To the glory of the king."
]
# ------------------------------------------

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {}

def save_cache(cache):
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)

def call_llm(prompt, model=MODEL_NAME):
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.4,
        "max_tokens": 1000,
    }
    try:
        response = requests.post(LM_STUDIO_URL, json=payload, timeout=60)
        response.raise_for_status()
        text = response.json()['choices'][0]['message']['content']
        # Strip <think> tags if present
        return re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
    except Exception as e:
        print(f"Error calling LLM: {e}")
        return ""

def prime_cache():
    cache = load_cache()
    if "en" not in cache:
        cache["en"] = {}
    
    # Identify all unique words across all texts
    # We want to cache words that are likely to be clicked or replaced
    # For simplicity, we process every alphanumeric word longer than 2 chars
    
    all_words_with_context = []
    for text in EXPERIENCE_TEXTS:
        # Simple extraction of words
        words = re.findall(r'\b\w+\b', text)
        for word in words:
            if len(word) > 2:
                all_words_with_context.append((word, text))

    print(f"Found {len(all_words_with_context)} potential words to cache.")
    
    # Deduplicate combinations of (word, context) to avoid redundant calls
    unique_tasks = list(set(all_words_with_context))
    print(f"Unique (word, context) tasks: {len(unique_tasks)}")

    processed_count = 0
    for word, context in unique_tasks:
        word_key = word.lower().strip()
        
        # We skip if ALREADY in cache
        if word_key in cache["en"]:
            # print(f"Skipping '{word}' - already in cache.")
            continue
            
        print(f"[{processed_count}/{len(unique_tasks)}] Generating synonyms for '{word}'...")
        
        prompt = f"""In en, list single-word replacements that could replace "{word}" in: "{context}". 
Each replacement must be exactly ONE word. Return ONLY a comma-separated list. No preamble."""

        result = call_llm(prompt)
        if result:
            synonyms = [s.strip().replace('"', '') for s in result.split(',') if s.strip()]
            # Filter multi-word, dedup
            seen = set()
            deduped = []
            for s in synonyms:
                s_clean = s.strip()
                if ' ' not in s_clean and s_clean.lower() not in seen:
                    deduped.append(s_clean)
                    seen.add(s_clean.lower())
            
            cache["en"][word_key] = deduped
            processed_count += 1
            
            # Save every 5 words to prevent loss
            if processed_count % 5 == 0:
                save_cache(cache)
                print(f"--- Cache saved ({len(cache['en'])} entries) ---")

    save_cache(cache)
    print(f"Done! Primed {processed_count} new words into the cache.")

if __name__ == "__main__":
    prime_cache()
