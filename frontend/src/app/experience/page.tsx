'use client';

import React, { useState } from 'react';
import { useExperience } from '@/components/ExperienceLogProvider';
import phrases from '@/lib/experience_phrases.json';

export default function ExperienceEntryPage() {
  const [mistralApiKey, setMistralApiKey] = useState('');
  const [mode, setMode] = useState<'edit' | 'readonly'>('edit');
  const [isLoading, setIsLoading] = useState(false);
  const { startExperience } = useExperience();

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Default to Participant 'Guest' and first phrase 'exp3' (3 sentences with cached synonyms)
      await startExperience(
        'Guest',
        phrases[0],
        mode,
        mistralApiKey.trim()
      );
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
          <h1 className="exp-title">TextBand</h1>
          <p className="exp-subtitle">
            Standalone web version setup.
          </p>
        </div>

        <form onSubmit={handleStart} className="exp-form">

          <div className="exp-field">
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
              <label className="exp-label" style={{ paddingLeft: '4px', margin: 0 }}>Mistral API Key</label>
              <a
                href="https://admin.mistral.ai/organization/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  marginLeft: '8px',
                  fontSize: '11px',
                  textTransform: 'none',
                  color: 'var(--accent-blue, #6366f1)',
                  textDecoration: 'underline',
                  fontWeight: 'normal'
                }}
              >
                (You can find a free key here)
              </a>
            </div>
            <input
              type="password"
              value={mistralApiKey}
              onChange={(e) => setMistralApiKey(e.target.value)}
              placeholder="Enter your Mistral API Key..."
              className="exp-input"
            />
          </div>

          <div className="exp-field">
            <label className="exp-label">Experience Mode</label>
            <div className="select-wrapper">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'edit' | 'readonly')}
                className="select exp-select"
              >
                <option value="edit">With Editing</option>
                <option value="readonly">Without Editing</option>
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
                Initializing...
              </>
            ) : (
              <>
                Start Experience
                <svg className="exp-btn-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ width: '20px', height: '20px' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </>
            )}
          </button>
        </form>

        {/* Warning Banner in Yellow/Amber */}
        <div style={{
          backgroundColor: 'rgba(217, 119, 6, 0.1)',
          border: '1px solid rgba(217, 119, 6, 0.3)',
          borderRadius: '8px',
          padding: '16px',
          color: '#d97706',
          fontSize: '13px',
          lineHeight: '1.6',
          marginTop: '16px',
          display: 'flex',
          gap: '12px'
        }}>
          <div style={{ fontSize: '18px', marginTop: '2px' }}>⚠️</div>
          <div>
            <strong>Warning:</strong> This simplified web version of TextBand is designed for testing the application directly in the browser. It differs from the version used during the scientific experiment (which did not use the Mistral model). Additionally, due to Mistral API rate limits, a 1.1 second delay is applied during synonym lookup, making the processing slower than the original experiment (which relied on an instant local cache).
          </div>
        </div>
      </div>
    </div>
  );
}
