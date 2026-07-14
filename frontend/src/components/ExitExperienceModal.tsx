'use client';

import React from 'react';
import Modal from './Modal';
import { AlertCircle } from 'lucide-react';

interface ExitExperienceModalProps {
  onClose: () => void;
  onConfirm: () => void;
}

export default function ExitExperienceModal({ onClose, onConfirm }: ExitExperienceModalProps) {
  return (
    <Modal title="Exit experience?" onClose={onClose}>
      <div className="flex flex-col items-center text-center gap-4 py-4">
        <div className="exp-modal-icon-wrapper" style={{ marginBottom: 0 }}>
          <AlertCircle className="exp-modal-icon" size={32} />
        </div>
        <p className="exp-subtitle">
          Are you sure you want to end this session? All your data will be saved.
        </p>
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>
          Continue experience
        </button>
        <button
          className="btn btn--danger"
          onClick={onConfirm}
        >
          Yes, quit
        </button>
      </div>
    </Modal>
  );
}
