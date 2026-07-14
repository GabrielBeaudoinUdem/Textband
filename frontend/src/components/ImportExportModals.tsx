'use client';

import React, { useState } from 'react';
import Modal from './Modal';
import { ClipboardCheck, ClipboardIcon } from 'lucide-react';

interface ImportModalProps {
  onClose: () => void;
  onImport: (text: string) => void;
}

export function ImportModal({ onClose, onImport }: ImportModalProps) {
  const [text, setText] = useState('');

  const handleImport = () => {
    if (text.trim()) {
      onImport(text);
      onClose();
    }
  };

  return (
    <Modal title="Import Text" onClose={onClose}>
      <textarea
        className="import-textarea"
        placeholder="Paste your text here..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" style={{ background: 'var(--accent-blue)', color: 'white', borderColor: 'var(--accent-blue)' }} onClick={handleImport}>
          OK (Segment Text)
        </button>
      </div>
    </Modal>
  );
}

interface ExportModalProps {
  text: string;
  onClose: () => void;
}

export function ExportModal({ text, onClose }: ExportModalProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <Modal title="Export Text" onClose={onClose}>
      <div className="export-box">
        {text}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={handleCopy}>
          {isCopied ? <ClipboardCheck size={16} /> : <ClipboardIcon size={16} />}
          {isCopied ? 'Copied!' : 'Copy to Clipboard'}
        </button>
        <button className="btn" style={{ background: 'var(--accent-blue)', color: 'white', borderColor: 'var(--accent-blue)' }} onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
