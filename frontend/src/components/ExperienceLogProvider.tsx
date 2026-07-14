'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface ExperienceContextType {
  participantId: string | null;
  phraseId: string | null;
  selectedPhrase: string | null;
  experienceMode: 'edit' | 'readonly';
  isExperienceActive: boolean;
  startExperience: (id: string, phrase: { id: string, text: string }, mode: 'edit' | 'readonly') => Promise<void>;
  stopExperience: (finalText: string) => Promise<void>;
  logLLM: (direction: 'sent' | 'received', content: any) => void;
  logTextHistory: (text: string) => void;
  logAction: (actionType: string, details?: any) => void;
}

const ExperienceContext = createContext<ExperienceContextType | null>(null);

export const useExperience = () => {
  const context = useContext(ExperienceContext);
  if (!context) throw new Error('useExperience must be used within ExperienceLogProvider');
  return context;
};

export const ExperienceLogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [phraseId, setPhraseId] = useState<string | null>(null);
  const [selectedPhrase, setSelectedPhrase] = useState<string | null>(null);
  const [experienceMode, setExperienceMode] = useState<'edit' | 'readonly'>('edit');
  const [isExperienceActive, setIsExperienceActive] = useState(false);
  

  const router = useRouter();

  // Helper to call our API
  const apiCall = useCallback(async (data: any) => {
    if (!participantId) return;
    try {
      await fetch('/api/experience', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, phraseId, ...data }),
      });
    } catch (err) {
      console.error('Logging failed', err);
    }
  }, [participantId]);

  const logLLM = useCallback((direction: 'sent' | 'received', content: any) => {
    if (!isExperienceActive) return;
    apiCall({
      type: 'log',
      filename: 'llm_logs.txt',
      content: `[LLM ${direction.toUpperCase()}] ${JSON.stringify(content)}`
    });
  }, [isExperienceActive, apiCall]);

  const logTextHistory = useCallback((text: string) => {
    if (!isExperienceActive) return;
    apiCall({
      type: 'log',
      filename: 'text_history.txt',
      content: text
    });
  }, [isExperienceActive, apiCall]);

  const logAction = useCallback((actionType: string, details?: any) => {
    if (!isExperienceActive) return;
    apiCall({
      type: 'log',
      filename: 'interaction_logs.txt',
      content: `[ACTION] ${actionType} ${details ? JSON.stringify(details) : ''}`
    });
  }, [isExperienceActive, apiCall]);



  const startExperience = async (id: string, phrase: { id: string, text: string }, mode: 'edit' | 'readonly') => {
    setParticipantId(id);
    setPhraseId(phrase.id);
    setSelectedPhrase(phrase.text);
    setExperienceMode(mode);
    
    // Create directory
    await fetch('/api/experience', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: id, phraseId: phrase.id, type: 'init' }),
    });


    setIsExperienceActive(true);
    router.push(mode === 'readonly' ? '/readonly' : '/');
  };

  const stopExperience = async (finalText: string) => {
    if (!participantId) return;

    // Save final text
    await fetch('/api/experience', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId, phraseId, type: 'final_text', content: finalText }),
    });
    


    setIsExperienceActive(false);
    setParticipantId(null);
    setPhraseId(null);
    setSelectedPhrase(null);
    setExperienceMode('edit');
    router.push('/experience');
  };

  // Global Event Logging
  useEffect(() => {
    if (!isExperienceActive) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      apiCall({
        type: 'log',
        content: `CLICK - x: ${e.clientX}, y: ${e.clientY}, target: ${target.tagName}, id: ${target.id}, text: ${target.innerText?.slice(0, 20)}`
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      apiCall({
        type: 'log',
        content: `KEYDOWN - key: ${e.key}, code: ${e.code}, target: ${(e.target as HTMLElement).tagName}`
      });
    };

    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExperienceActive, apiCall]);

  return (
    <ExperienceContext.Provider value={{
      participantId,
      phraseId,
      selectedPhrase,
      experienceMode,
      isExperienceActive,
      startExperience,
      stopExperience,
      logLLM,
      logTextHistory,
      logAction
    }}>
      {children}
    </ExperienceContext.Provider>
  );
};
