'use client';

import React, { useState } from 'react';
import { useExperience } from '@/components/ExperienceLogProvider';
import phrases from '@/lib/experience_phrases.json';

export default function ExperienceEntryPage() {
  const [participantId, setParticipantId] = useState('');
  const [selectedPhrase, setSelectedPhrase] = useState<{ id: string, text: string }>(phrases[0]);
  const [mode, setMode] = useState<'edit' | 'readonly'>('edit');
  const [isLoading, setIsLoading] = useState(false);
  const { startExperience } = useExperience();

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!participantId.trim()) {
      alert('Veuillez entrer un ID de participant.');
      return;
    }
    setIsLoading(true);
    try {
      await startExperience(participantId.trim(), selectedPhrase, mode);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="exp-container">
      <div className="exp-card">
        <div className="exp-header">
          <h1 className="exp-title">Étude TextBand</h1>
          <p className="exp-subtitle">
            Bienvenue dans l'étude utilisateur. Veuillez entrer vos informations pour commencer.
          </p>
        </div>

        <form onSubmit={handleStart} className="exp-form">
          <div className="exp-field">
            <label className="exp-label">ID du Participant</label>
            <input
              type="text"
              value={participantId}
              onChange={(e) => setParticipantId(e.target.value)}
              placeholder="e.g. P01"
              className="exp-input"
              required
            />
          </div>

          <div className="exp-field">
            <label className="exp-label">Phrase à tester</label>
            <div className="select-wrapper">
              <select
                value={selectedPhrase.id}
                onChange={(e) => {
                  const phrase = phrases.find(p => p.id === e.target.value);
                  if (phrase) setSelectedPhrase(phrase);
                }}
                className="select exp-select"
              >
                {phrases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || p.text}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="exp-field">
            <label className="exp-label">Mode d'expérience</label>
            <div className="select-wrapper">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'edit' | 'readonly')}
                className="select exp-select"
              >
                <option value="edit">Avec Édition</option>
                <option value="readonly">Sans Édition</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={`btn-primary exp-submit ${isLoading ? 'loading' : ''}`}
          >
            {isLoading ? (
              <>
                <div className="spinner-small"></div>
                Initialisation...
              </>
            ) : (
              <>
                Commencer l'expérience
                <svg className="exp-btn-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </>
            )}
          </button>
        </form>

        <div className="exp-footer-note">
          <p>
            <strong>Note:</strong> L'enregistrement de l'écran sera activé au début de l'expérience. Vos données seront enregistrées anonymement pour la recherche.
          </p>
        </div>
      </div>
    </div>
  );
}
