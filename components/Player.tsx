import React, { useEffect, useRef, useState } from 'react';
import { ScriptItem, ItemType } from '../types';
import { getAudioContext } from '../utils/audioUtils';

interface PlayerProps {
  items: ScriptItem[];
  isPlaying: boolean;
  onPlayStateChange: (isPlaying: boolean, currentId: string | null) => void;
}

export const Player: React.FC<PlayerProps> = ({ items, isPlaying, onPlayStateChange }) => {
  const [currentIdx, setCurrentIdx] = useState<number>(-1);
  const [youtubePlayer, setYoutubePlayer] = useState<any>(null);
  
  // Refs to manage active playback state
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const youtubeContainerRef = useRef<HTMLDivElement>(null);
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
    // Stop YouTube
    if (youtubePlayer && typeof youtubePlayer.stopVideo === 'function') {
      youtubePlayer.stopVideo();
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
      if (item.youtubeId) {
        playYoutubeSfx(item.youtubeId, item.youtubeStartTime || 0, item.youtubeDuration || 5, () => playItem(index + 1));
      } else {
        // Wait default duration if no ID
        timeoutRef.current = window.setTimeout(() => playItem(index + 1), 2000);
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

  const playYoutubeSfx = (videoId: string, start: number, duration: number, onEnded: () => void) => {
    // We assume youtubePlayer is initialized via the global API loaded in App or here.
    // Since we need to dynamically load/play specific videos, we might destroy/recreate or just loadVideoById
    
    // For simplicity in this demo, we assume the iframe exists and we use the player API
    if (!youtubePlayer) {
      // If player not ready, skip after short delay
      console.warn("YouTube Player not ready");
      timeoutRef.current = window.setTimeout(onEnded, 2000);
      return;
    }

    youtubePlayer.loadVideoById({
      videoId: videoId,
      startSeconds: start,
      endSeconds: start + duration
    });
    youtubePlayer.playVideo();

    // The YouTube API doesn't always strictly respect endSeconds for firing an event in all embed modes,
    // so we set a safety timeout to move next.
    timeoutRef.current = window.setTimeout(() => {
        youtubePlayer.stopVideo();
        onEnded();
    }, duration * 1000 + 500); // 500ms buffer
  };

  // Initialize YouTube API
  useEffect(() => {
    // Load IFrame API
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    (window as any).onYouTubeIframeAPIReady = () => {
      const player = new (window as any).YT.Player('youtube-hidden-player', {
        height: '0',
        width: '0',
        playerVars: {
          'playsinline': 1,
          'controls': 0,
        },
        events: {
          'onReady': (event: any) => {
             setYoutubePlayer(event.target);
          }
        }
      });
    };
    
    return () => {
        // Cleanup if necessary
    }
  }, []);

  return (
    <div className="hidden">
      <div id="youtube-hidden-player" ref={youtubeContainerRef}></div>
    </div>
  );
};
