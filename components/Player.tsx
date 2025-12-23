import React, { useEffect, useRef, useState } from 'react';
import { ScriptItem, ItemType } from '../types';
import { getAudioContext } from '../utils/audioUtils';

interface PlayerProps {
  items: ScriptItem[];
  isPlaying: boolean;
  enableSfx: boolean;
  onPlayStateChange: (isPlaying: boolean, currentId: string | null) => void;
}

export const Player: React.FC<PlayerProps> = ({ items, isPlaying, enableSfx, onPlayStateChange }) => {
  const [currentIdx, setCurrentIdx] = useState<number>(-1);

  // Refs to manage active playback state
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);

  // Sync ref
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (!isPlaying) {
      stopAll();
    } else if (currentIdx === -1 && items.length > 0) {
      // Start from beginning
      playItem(0);
    }
  }, [isPlaying, items]);

  const stopAll = () => {
    // Stop Web Audio
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch (e) { /* ignore */ }
      activeSourceRef.current = null;
    }
    // Clear timeouts
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setCurrentIdx(-1);
    onPlayStateChange(false, null);
  };

  const playItem = async (index: number) => {
    if (index >= items.length || !isPlayingRef.current) {
      stopAll();
      return;
    }

    setCurrentIdx(index);
    const item = items[index];
    onPlayStateChange(true, item.id);

    if (item.type === ItemType.SPEECH) {
      if (item.audioBuffer) {
        playAudioBuffer(item.audioBuffer, () => playItem(index + 1));
      } else {
        // Skip if no audio generated
        console.warn(`Skipping item ${index}: No audio generated`);
        playItem(index + 1);
      }
    } else if (item.type === ItemType.SFX) {
      // If SFX is disabled in settings, skip the SFX item entirely
      if (!enableSfx) {
        console.log(`Skipping SFX item ${index}: Sound Effects disabled in settings`);
        playItem(index + 1);
        return;
      }

      // Check for generated audio buffer, otherwise skip
      if (item.audioBuffer) {
        playAudioBuffer(item.audioBuffer, () => playItem(index + 1));
      } else {
        // Skip SFX without audio - no more YouTube fallback
        console.warn(`Skipping SFX item ${index}: No audio generated`);
        playItem(index + 1);
      }
    }
  };

  const playAudioBuffer = (buffer: AudioBuffer, onEnded: () => void) => {
    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      activeSourceRef.current = null;
      onEnded();
    };
    activeSourceRef.current = source;
    source.start();
  };

  return (
    <div className="hidden">
      {/* No longer need hidden YouTube player */}
    </div>
  );
};