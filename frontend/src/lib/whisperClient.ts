/**
 * Client-side Speech-to-Text helper using native browser SpeechRecognition.
 * This runs completely client-side in the browser, requires zero model downloads,
 * and works instantly on all modern browsers (Chrome, Safari, Edge).
 */

export interface SpeechRecognizer {
  stop: () => void;
}

export function startLocalTranscription(
  language: string,
  onResult: (text: string) => void,
  onError: (err: any) => void
): SpeechRecognizer {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    const errMsg = 'Speech Recognition API is not supported in this browser. Please use Chrome, Safari, or Edge.';
    console.error(errMsg);
    onError(new Error(errMsg));
    return { stop: () => {} };
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  // Force English as requested by the user ("Je pense qu'on va faire juste en anglais")
  recognition.lang = 'en-US';

  let finalTranscript = '';

  recognition.onresult = (event: any) => {
    let resultText = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        resultText += event.results[i][0].transcript;
      }
    }
    if (resultText) {
      finalTranscript += (finalTranscript ? ' ' : '') + resultText.trim();
      onResult(finalTranscript);
    }
  };

  recognition.onerror = (event: any) => {
    console.error('Speech Recognition Error:', event.error);
    onError(event);
  };

  recognition.onend = () => {
    console.log('Speech Recognition ended.');
  };

  try {
    recognition.start();
  } catch (err) {
    console.error('Failed to start Speech Recognition:', err);
    onError(err);
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch (err) {
        console.error('Error stopping Speech Recognition:', err);
      }
    }
  };
}
