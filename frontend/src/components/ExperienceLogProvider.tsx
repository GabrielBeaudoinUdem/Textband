'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { setMistralApiKey as setLLMMistralApiKey } from '@/lib/llmClient';

interface ExperienceContextType {
  participantId: string | null;
  phraseId: string | null;
  selectedPhrase: string | null;
  experienceMode: 'edit' | 'readonly';
  isExperienceActive: boolean;
  mistralApiKey: string;
  startExperience: (id: string, phrase: { id: string, text: string }, mode: 'edit' | 'readonly', apiKey: string) => Promise<void>;
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
  const [mistralApiKey, setMistralApiKeyState] = useState<string>('');
  

  const router = useRouter();

  // Helper to call our API (Disabled for online version)
  const apiCall = useCallback(async (data: any) => {
    // No-op
  }, []);

  const logLLM = useCallback((direction: 'sent' | 'received', content: any) => {
    // No-op
  }, []);

  const logTextHistory = useCallback((text: string) => {
    // No-op
  }, []);

  const logAction = useCallback((actionType: string, details?: any) => {
    // No-op
  }, []);



  const startExperience = async (id: string, phrase: { id: string, text: string }, mode: 'edit' | 'readonly', apiKey: string) => {
    setParticipantId(id);
    setPhraseId(phrase.id);
    setSelectedPhrase(phrase.text);
    setExperienceMode(mode);
    setMistralApiKeyState(apiKey);
    setLLMMistralApiKey(apiKey);
    
    setIsExperienceActive(true);
    router.push(mode === 'readonly' ? '/readonly' : '/');
  };

  const stopExperience = async (finalText: string) => {
    if (!participantId) return;

    setIsExperienceActive(false);
    setParticipantId(null);
    setPhraseId(null);
    setSelectedPhrase(null);
    setMistralApiKeyState('');
    setLLMMistralApiKey('');
    setExperienceMode('edit');
    router.push('/experience');
  };

  // Global Event Logging (Disabled for online version)
  useEffect(() => {
    // No-op
  }, []);

  return (
    <ExperienceContext.Provider value={{
      participantId,
      phraseId,
      selectedPhrase,
      experienceMode,
      isExperienceActive,
      mistralApiKey,
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
