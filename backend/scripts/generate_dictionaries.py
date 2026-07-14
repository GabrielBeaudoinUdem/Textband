import sqlite3
import json
import os
import re

# Paths
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
DATA_DIR = os.path.join(FRONTEND_DIR, "src", "data")
PUBLIC_DIR = os.path.join(FRONTEND_DIR, "public", "dictionaries")

PHONETICS_JSON_PATH = os.path.join(DATA_DIR, "phonetics.json")
import sys
import site

# Try to dynamically locate site-packages path
def find_lexicon_path(lang_pkg):
    for path_dir in sys.path:
        target = os.path.join(path_dir, lang_pkg, "lexicon.db")
        if os.path.exists(target):
            return target
    # Fallback to standard locations or virtualenv
    try:
        user_site = site.getusersitepackages()
        target = os.path.join(user_site, lang_pkg, "lexicon.db")
        if os.path.exists(target):
            return target
    except:
        pass
    return f"lexicon_{lang_pkg}.db" # generic fallback

EN_LEXICON_PATH = find_lexicon_path("gruut_lang_en")
FR_LEXICON_PATH = find_lexicon_path("gruut_lang_fr")

# Ensure dictionaries directory exists
if not os.path.exists(PUBLIC_DIR):
    os.makedirs(PUBLIC_DIR)

# Load phonetics data
with open(PHONETICS_JSON_PATH, "r", encoding="utf-8") as f:
    phonetics_data = json.load(f)

def normalize_phoneme(ph):
    norm = re.sub(r'[ˈˌː]', '', ph)
    maps = {
        'ɹ': 'r',
        'g': 'ɡ',
    }
    return maps.get(norm, norm)

def dump_lexicon(lexicon_path, language_key, output_path):
    print(f"Generating dictionary for {language_key}...")
    valid_phonemes = set(phonetics_data[language_key]["order"])
    
    conn = sqlite3.connect(lexicon_path)
    cursor = conn.cursor()
    
    # We only take pron_order = 1 (primary pronunciation)
    cursor.execute("SELECT word, phonemes FROM word_phonemes WHERE pron_order = 1")
    rows = cursor.fetchall()
    
    dict_list = []
    
    # Track to avoiding duplicate words
    seen = set()
    
    for word, phonemes_str in rows:
        if not word or not phonemes_str:
            continue
            
        word_lower = word.lower()
        if word_lower in seen:
            continue
            
        raw_ph_list = phonemes_str.split(" ")
        norm_ph_list = [normalize_phoneme(p) for p in raw_ph_list]
        
        # Check if all phonemes are valid
        if all(p in valid_phonemes for p in norm_ph_list):
            dict_list.append({
                "w": word_lower,
                "p": norm_ph_list
            })
            seen.add(word_lower)
            
    conn.close()
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(dict_list, f, ensure_ascii=False, separators=(',', ':'))
        
    print(f"Saved {len(dict_list)} words to {output_path}")

print("Starting dictionary generation...")
dump_lexicon(EN_LEXICON_PATH, "en", os.path.join(PUBLIC_DIR, "en.json"))
dump_lexicon(FR_LEXICON_PATH, "fr", os.path.join(PUBLIC_DIR, "fr.json"))
print("Done!")
