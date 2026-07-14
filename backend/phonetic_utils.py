import re

def split_phonemes(phonemes: list[str]) -> dict:
    """
    Splits a list of phonemes into three logical parts: beginning, middle, and end.
    
    New logic: 
    - begin: strictly the first phoneme
    - end: strictly the last phoneme
    - mid: all phonemes in between
    
    Returns a dict: {"begin": list, "mid": list, "end": list}
    """
    n = len(phonemes)
    if n == 0:
        return {"begin": [], "mid": [], "end": []}
    
    if n == 1:
        # A single phoneme counts for both begin and end; mid is empty
        return {"begin": [phonemes[0]], "mid": [], "end": [phonemes[0]]}
    
    # For n >= 2:
    # begin = [first], end = [last], mid = [elements in between]
    return {
        "begin": [phonemes[0]],
        "mid": phonemes[1:-1],
        "end": [phonemes[-1]]
    }

def matches_constraints(word_phonemes: list[str], constraints: dict) -> bool:
    """
    Checks if a list of phonemes matches the given constraints.
    
    constraints: {
        "begin": {"forced": str or None, "forbidden": list},
        "mid": {"forced": str or None, "forbidden": list},
        "end": {"forced": str or None, "forbidden": list}
    }
    """
    parts = split_phonemes(word_phonemes)
    
    for section in ["begin", "mid", "end"]:
        section_phonemes = parts[section]
        section_constraints = constraints.get(section, {})
        
        # 1. Check FORCED (Blue) - Sound must be present in this section
        forced = section_constraints.get("forced")
        if forced:
            if forced not in section_phonemes:
                return False
        
        # 2. Check FORBIDDEN (Red) - Sound must NOT be present in this section
        forbidden = section_constraints.get("forbidden", [])
        for f_sound in forbidden:
            if f_sound in section_phonemes:
                return False
                
    return True
