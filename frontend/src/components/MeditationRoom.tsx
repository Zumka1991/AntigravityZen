import React, { useState, useEffect, useRef } from 'react';
import type { RoomInfo, Track } from './RoomList';
import type { translations } from '../translations';

interface Message {
  type: string;
  username?: string;
  text?: string;
  timestamp: number;
}

interface MeditationRoomProps {
  roomState: RoomInfo & { clients: { id: string; username: string; isHost: boolean }[]; status: string; duration: number; startedAt: number; serverTime: number };
  clientId: string;
  username: string;
  tracks: Track[];
  messages: Message[];
  onSendMessage: (text: string) => void;
  onStartMeditation: (trackId: string, duration: number, voiceTrackId?: string) => void;
  onStopMeditation: () => void;
  onLeaveRoom: () => void;
  t: typeof translations.en;
  voiceNarrator: string | null;
  voiceFileUrl: string | null;
  isVoiceStatic?: boolean;
  registerVoiceListener: (listener: (chunk: ArrayBuffer) => void) => () => void;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onVoiceData: (arrayBuffer: ArrayBuffer) => void;
}

export const MeditationRoom: React.FC<MeditationRoomProps> = ({
  roomState,
  clientId,
  username,
  tracks,
  messages,
  onSendMessage,
  onStartMeditation,
  onStopMeditation,
  onLeaveRoom,
  t,
  voiceNarrator,
  voiceFileUrl,
  isVoiceStatic = false,
  registerVoiceListener,
  onVoiceStart,
  onVoiceStop,
  onVoiceData,
}) => {
  const [chatInput, setChatInput] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [breathPhase, setBreathPhase] = useState<'inhale' | 'exhale'>('inhale');
  const [breathScale, setBreathScale] = useState(1.0);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);

  // Audio Volume States
  const [musicVolume, setMusicVolume] = useState(0.8);
  const [voiceVolume, setVoiceVolume] = useState(1.0);
  const [showVolumeControls, setShowVolumeControls] = useState(false);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleMusicVolumeChange = (newVal: number) => {
    setMusicVolume(newVal);
    if (audioRef.current) {
      audioRef.current.volume = newVal;
    }
  };

  const handleVoiceVolumeChange = (newVal: number) => {
    setVoiceVolume(newVal);
    if (voiceAudioRef.current) {
      voiceAudioRef.current.volume = newVal;
    }
  };

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Microphone streaming & recording state (Host)
  const [isMicrophoneActive, setIsMicrophoneActive] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const [showMicModal, setShowMicModal] = useState(false);
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState('');

  // Diagnostic microphone volume test states & refs
  const [micLevel, setMicLevel] = useState(0);
  const testStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Active streaming microphone volume analysis states & refs
  const [streamingMicLevel, setStreamingMicLevel] = useState(0);
  const streamingAudioContextRef = useRef<AudioContext | null>(null);
  const streamingAnimationFrameRef = useRef<number | null>(null);

  const stopStreamingMicAnalysis = () => {
    if (streamingAnimationFrameRef.current) {
      cancelAnimationFrame(streamingAnimationFrameRef.current);
      streamingAnimationFrameRef.current = null;
    }
    if (streamingAudioContextRef.current) {
      if (streamingAudioContextRef.current.state !== 'closed') {
        streamingAudioContextRef.current.close().catch(() => {});
      }
      streamingAudioContextRef.current = null;
    }
    setStreamingMicLevel(0);
  };

  const startStreamingMicAnalysis = (stream: MediaStream) => {
    stopStreamingMicAnalysis();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      streamingAudioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevel = () => {
        if (!stream.active) return;
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        let count = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
          if (dataArray[i] > 0) count++;
        }

        const average = count > 0 ? (sum / bufferLength) : 0;
        const percentage = Math.min(100, Math.round((average / 150) * 100));
        setStreamingMicLevel(percentage);

        streamingAnimationFrameRef.current = requestAnimationFrame(updateLevel);
      };

      streamingAnimationFrameRef.current = requestAnimationFrame(updateLevel);
    } catch (e) {
      console.warn("Failed to start streaming mic analysis:", e);
    }
  };

  const stopMicTest = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
    }
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach(track => track.stop());
      testStreamRef.current = null;
    }
    setMicLevel(0);
  };

  const startMicTest = async (deviceId: string) => {
    stopMicTest(); // Stop any active test first
    try {
      const constraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevel = () => {
        if (!stream.active) return;
        analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        let count = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
          if (dataArray[i] > 0) count++;
        }
        
        const average = count > 0 ? (sum / bufferLength) : 0;
        // Boost sensitivity for visual feedback
        const percentage = Math.min(100, Math.round((average / 150) * 100)); 
        setMicLevel(percentage);

        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };

      animationFrameRef.current = requestAnimationFrame(updateLevel);
    } catch (e) {
      console.warn("Failed to start mic test:", e);
    }
  };

  const handleMicDeviceChange = (deviceId: string) => {
    setSelectedMicId(deviceId);
    startMicTest(deviceId);
  };

  const stopMicrophone = () => {
    stopMicTest();
    stopStreamingMicAnalysis();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach(track => track.stop());
    }
    setIsMicrophoneActive(false);
    onVoiceStop();
  };

  const toggleMicrophone = async () => {
    if (isMicrophoneActive) {
      stopMicrophone();
    } else {
      const isRu = t.leaveRoom === 'Выйти из комнаты';
      try {
        // Enumerate devices first
        let devices = await navigator.mediaDevices.enumerateDevices();
        let audioInputs = devices.filter(device => device.kind === 'audioinput');

        // Check if we need to request permission (e.g. if list is empty or labels are empty)
        const hasNoLabels = audioInputs.length > 0 && audioInputs.every(d => !d.label);

        if (audioInputs.length === 0 || hasNoLabels) {
          // Request permission to populate labels or discover devices
          const initialStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          initialStream.getTracks().forEach(track => track.stop());

          // Re-enumerate after permission is granted
          devices = await navigator.mediaDevices.enumerateDevices();
          audioInputs = devices.filter(device => device.kind === 'audioinput');
        }

        setAvailableMics(audioInputs);

        if (audioInputs.length > 0) {
          const savedMicId = localStorage.getItem('zen_selected_mic_id');
          const exists = audioInputs.some(d => d.deviceId === savedMicId);
          const activeId = exists ? savedMicId! : audioInputs[0].deviceId;
          setSelectedMicId(activeId);
          setShowMicModal(true);
          startMicTest(activeId); // Start volume test instantly
        } else {
          alert(isRu 
            ? 'В системе не обнаружено ни одного микрофона. Пожалуйста, подключите микрофон или гарнитуру к компьютеру и попробуйте снова.' 
            : 'No microphone detected in your system. Please plug in a microphone or headset and try again.');
        }
      } catch (err: any) {
        console.error('Microphone access failed:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          alert(isRu 
            ? 'Доступ к микрофону заблокирован браузером. Пожалуйста, нажмите на значок замочка в адресной строке (слева от localhost:5173) и включите микрофон.'
            : 'Microphone access is blocked by the browser. Please click the lock icon in the address bar (left of localhost:5173) and enable the microphone.');
        } else {
          alert(t.micAccessError || 'Could not access microphone.');
        }
      }
    }
  };

  const startMicrophoneWithDevice = async (deviceId: string) => {
    stopMicTest(); // Stop the test context before starting streaming
    try {
      localStorage.setItem('zen_selected_mic_id', deviceId);
      const constraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      microphoneStreamRef.current = stream;

      startStreamingMicAnalysis(stream); // Start active voice level analysis
      onVoiceStart();

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          const arrayBuffer = await event.data.arrayBuffer();
          onVoiceData(arrayBuffer);
        }
      };

      mediaRecorder.start(250); // timeslice of 250ms for streaming
      setIsMicrophoneActive(true);
      setShowMicModal(false);
    } catch (err) {
      console.error('Microphone start failed:', err);
      alert(t.micAccessError || 'Could not access microphone.');
    }
  };

  // Clean up mic capture on unmount
  useEffect(() => {
    return () => {
      stopMicTest();
      stopStreamingMicAnalysis();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (microphoneStreamRef.current) {
        microphoneStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Voice stream playback logic (Participants)
  useEffect(() => {
    if (voiceNarrator && !isMicrophoneActive) {
      const audio = new Audio();
      audio.volume = voiceVolume;
      voiceAudioRef.current = audio;

      if (isVoiceStatic) {
        console.log("[Voice] Static pre-recorded playback playing file:", voiceFileUrl);
        if (voiceFileUrl) {
          audio.src = voiceFileUrl;
          audio.play().catch(e => console.warn("[Voice] Pre-recorded play failed:", e));
        }
        return () => {
          audio.pause();
          audio.src = '';
          voiceAudioRef.current = null;
          console.log("[Voice] Pre-recorded playback stream stopped.");
        };
      }

      const useMSE = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/webm; codecs=opus');
      console.log(`[Voice] Starting playback stream. Mode: ${useMSE ? 'MSE (Low Latency)' : 'Progressive Fallback'}`);
      
      let unsubscribe = () => {};

      if (useMSE) {
        const mediaSource = new MediaSource();
        audio.src = URL.createObjectURL(mediaSource);
        audio.play().catch(e => console.warn("[Voice] Playback play failed on init:", e));

        const queue: ArrayBuffer[] = [];
        let sourceBuffer: SourceBuffer | null = null;
        let isReady = false;

        const handleSourceOpen = () => {
          try {
            sourceBuffer = mediaSource.addSourceBuffer('audio/webm; codecs=opus');
            isReady = true;
            console.log("[Voice] MSE SourceBuffer opened successfully.");

            // Append any chunks accumulated during initialization
            while (queue.length > 0 && sourceBuffer && !sourceBuffer.updating) {
              const next = queue.shift()!;
              sourceBuffer.appendBuffer(next);
            }

            sourceBuffer.addEventListener('updateend', () => {
              if (queue.length > 0 && sourceBuffer && !sourceBuffer.updating) {
                const next = queue.shift()!;
                sourceBuffer.appendBuffer(next);
              }
            });
          } catch (e) {
            console.error("[Voice] MSE addSourceBuffer error:", e);
          }
        };

        mediaSource.addEventListener('sourceopen', handleSourceOpen);

        unsubscribe = registerVoiceListener((chunk) => {
          if (isReady && sourceBuffer) {
            if (sourceBuffer.updating || queue.length > 0) {
              queue.push(chunk);
            } else {
              try {
                sourceBuffer.appendBuffer(chunk);
                if (audio.paused) {
                  audio.play().catch(() => {});
                }
              } catch (e) {
                console.warn("[Voice] MSE appendBuffer failed (retrying in queue):", e);
                queue.push(chunk);
              }
            }
          } else {
            // Accumulate chunks (especially critical WebM container headers) until ready
            queue.push(chunk);
          }
        });

        return () => {
          unsubscribe();
          try {
            if (mediaSource.readyState === 'open') {
              mediaSource.endOfStream();
            }
          } catch (e) {}
          audio.pause();
          audio.src = '';
          voiceAudioRef.current = null;
          console.log("[Voice] MSE playback stream stopped.");
        };
      } else {
        // Fallback for Safari/iOS (uses growing progressive download from server)
        if (voiceFileUrl) {
          console.log("[Voice] Progressive fallback playing file:", voiceFileUrl);
          // Add random token to prevent caching
          audio.src = `${voiceFileUrl}?cb=${Date.now()}`;
          audio.play().catch(e => console.warn("[Voice] Fallback playback failed:", e));

          const intervalId = setInterval(() => {
            if (audio.paused && audio.currentTime > 0 && !audio.ended) {
              audio.play().catch(() => {});
            }
          }, 2500);

          return () => {
            clearInterval(intervalId);
            audio.pause();
            audio.src = '';
            voiceAudioRef.current = null;
            console.log("[Voice] Fallback playback stream stopped.");
          };
        } else {
          console.warn("[Voice] Progressive fallback active but no voiceFileUrl provided.");
        }
      }
    }
  }, [voiceNarrator, voiceFileUrl, registerVoiceListener, username, voiceVolume, isMicrophoneActive, isVoiceStatic]);

  const isHost = roomState.hostId === clientId;
  const isPlaying = roomState.status === 'playing';

  // Configurable states for host before starting
  const ambientTracks = tracks.filter(tr => !tr.ownerUsername || tr.isPublic);
  const recordedTracks = tracks.filter(tr => !!tr.ownerUsername && !tr.isPublic);

  const [selectedTrackId, setSelectedTrackId] = useState(roomState.activeTrack?.id || ambientTracks[0]?.id || '');
  const [selectedVoiceTrackId, setSelectedVoiceTrackId] = useState<string>('live');
  const [selectedDuration, setSelectedDuration] = useState(roomState.duration || 60);

  const standardDurations = [30, 60, 300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200];
  const durationOptions = [...standardDurations];
  if (!durationOptions.includes(selectedDuration)) {
    durationOptions.push(selectedDuration);
    durationOptions.sort((a, b) => a - b);
  }

  const getDurationOptionLabel = (seconds: number) => {
    if (seconds === 30) return t.testDuration;
    if (seconds === 60) return t.minute1;
    if (seconds === 300) return t.minutes5;
    if (seconds === 600) return t.minutes10;
    if (seconds === 900) return t.minutes15;
    if (seconds === 1200) return t.minutes20;
    if (seconds === 1800) return t.minutes30;
    if (seconds === 2700) return t.minutes45;
    if (seconds === 3600) return t.hour1;
    if (seconds === 5400) return t.hour1_5;
    if (seconds === 7200) return t.hour2;
    
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0 && secs > 0) {
      return `${mins} ${t.durationMinutes} ${secs} ${t.durationSeconds}`;
    } else if (mins > 0) {
      return `${mins} ${t.durationMinutes}`;
    } else {
      return `${secs} ${t.durationSeconds}`;
    }
  };

  const handleCopyLink = () => {
    const inviteUrl = `${window.location.origin}?roomId=${roomState.id}`;
    navigator.clipboard.writeText(inviteUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => console.error('Could not copy text: ', err));
  };

  const serverOffsetRef = useRef(0);

  // Sync server offset when roomState update arrives
  useEffect(() => {
    if (roomState) {
      serverOffsetRef.current = roomState.serverTime - Date.now();
    }
  }, [roomState.serverTime]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Audio player synchronization
  useEffect(() => {
    const track = roomState.activeTrack;
    if (isPlaying && track) {
      // Calculate current elapsed time on server using our stable offset
      const currentServerTime = Date.now() + serverOffsetRef.current;
      const elapsedMs = currentServerTime - roomState.startedAt;
      const elapsedSeconds = Math.max(0, elapsedMs / 1000);

      if (elapsedSeconds < roomState.duration) {
        if (!audioRef.current) {
          audioRef.current = new Audio(track.audioUrl);
          audioRef.current.loop = true;
        } else if (audioRef.current.src !== track.audioUrl) {
          audioRef.current.src = track.audioUrl;
        }

        audioRef.current.muted = isMuted;
        audioRef.current.volume = musicVolume;
        audioRef.current.currentTime = elapsedSeconds;

        // Try to play audio
        audioRef.current.play()
          .then(() => {
            setAutoplayBlocked(false);
          })
          .catch((err) => {
            console.warn('Autoplay blocked:', err);
            setAutoplayBlocked(true);
          });
      } else {
        // Meditation already finished
        if (audioRef.current) {
          audioRef.current.pause();
        }
      }
    } else {
      // Not playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setAutoplayBlocked(false);
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [isPlaying, roomState.activeTrack?.id, roomState.startedAt, roomState.duration]);

  // Handle mute/unmute
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Sync state settings if host changed them in lobby
  useEffect(() => {
    if (!isPlaying) {
      if (roomState.activeTrack) {
        setSelectedTrackId(roomState.activeTrack.id);
      }
      if (roomState.duration) {
        setSelectedDuration(roomState.duration);
      }
    }
  }, [roomState.activeTrack?.id, roomState.duration, isPlaying]);

  // Real-time animation loop for remaining time & breathing visualizer
  useEffect(() => {
    let animationFrameId: number;

    const updateFrame = () => {
      if (isPlaying && roomState.startedAt) {
        const clientTimeNow = Date.now();
        const currentServerTime = clientTimeNow + serverOffsetRef.current;
        
        const elapsedMs = currentServerTime - roomState.startedAt;
        const elapsedSec = elapsedMs / 1000;
        
        const remaining = Math.max(0, roomState.duration - elapsedSec);
        setTimeRemaining(remaining);

        // Breathing calculations (5 seconds inhale, 5 seconds exhale)
        const breathCycle = 10; // total 10s cycle
        const cycleTime = elapsedSec % breathCycle;
        
        if (cycleTime < 5) {
          setBreathPhase('inhale');
          // Scale from 1.0 to 1.75
          const progress = cycleTime / 5;
          setBreathScale(1.0 + progress * 0.75);
        } else {
          setBreathPhase('exhale');
          // Scale from 1.75 down to 1.0
          const progress = (cycleTime - 5) / 5;
          setBreathScale(1.75 - progress * 0.75);
        }
      } else {
        setTimeRemaining(0);
        setBreathScale(1.0);
      }

      animationFrameId = requestAnimationFrame(updateFrame);
    };

    animationFrameId = requestAnimationFrame(updateFrame);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, roomState.startedAt, roomState.duration]);

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim()) {
      onSendMessage(chatInput.trim());
      setChatInput('');
    }
  };

  const forcePlayAudio = () => {
    if (audioRef.current && roomState.startedAt) {
      const currentServerTime = Date.now() + serverOffsetRef.current;
      const elapsedMs = currentServerTime - roomState.startedAt;
      const elapsedSeconds = Math.max(0, elapsedMs / 1000);

      try {
        audioRef.current.load();
        audioRef.current.currentTime = elapsedSeconds;
        audioRef.current.play()
          .then(() => {
            setAutoplayBlocked(false);
          })
          .catch(err => console.error("Force play failed:", err));
      } catch (err) {
        console.error("Error reloading and playing audio:", err);
      }
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Helper to translate track details
  const getTrackTitle = (track: Track | undefined) => {
    if (!track) return '';
    return (t as any)[track.id] || track.title;
  };

  return (
    <div className="room-grid">
      {/* Meditation Center Area */}
      <div className="glass-panel meditation-center">
        {/* Top bar controls */}
        <div className="room-top-bar">
          <button 
            className="btn btn-secondary" 
            onClick={onLeaveRoom} 
            style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            {t.leaveRoom}
          </button>

          {voiceNarrator ? (
            <div 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem', 
                background: 'rgba(239, 68, 68, 0.1)', 
                border: '1px solid rgba(239, 68, 68, 0.2)', 
                color: '#f87171', 
                padding: '0.35rem 0.75rem', 
                borderRadius: '20px', 
                fontSize: '0.8rem', 
                fontWeight: 600,
                alignSelf: 'center',
                boxShadow: '0 0 15px rgba(239, 68, 68, 0.15)'
              }}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block', boxShadow: '0 0 8px #ef4444' }}></span>
              <span>{t.onAir}: {voiceNarrator}</span>
            </div>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          <button 
            className="btn btn-primary" 
            onClick={handleCopyLink} 
            style={{ 
              padding: '0.5rem 1rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.35rem',
              background: copied ? 'rgba(45, 212, 191, 0.2)' : 'var(--color-primary)',
              border: copied ? '1px solid var(--color-secondary)' : 'none',
              color: copied ? 'var(--color-secondary)' : '#06050e',
              transition: 'all 0.3s ease'
            }}
          >
            {copied ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                {t.linkCopied}
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
                {t.copyLink}
              </>
            )}
          </button>
        </div>

        {/* Meditation Player Active State */}
        {isPlaying ? (
          <div className="meditation-stage">
            <div className="track-info">
              <h2>{getTrackTitle(roomState.activeTrack)}</h2>
              <p>by {roomState.activeTrack?.artist}</p>
            </div>

            {/* Pulsing Breathing Ring */}
            <div className="visualizer-container">
              <div 
                className="breathing-ring" 
                style={{ 
                  transform: `scale(${breathScale})`, 
                  borderColor: breathPhase === 'inhale' ? 'rgba(45, 212, 191, 0.25)' : 'rgba(167, 139, 250, 0.25)',
                  boxShadow: breathPhase === 'inhale' ? '0 0 30px rgba(45, 212, 191, 0.15)' : '0 0 30px rgba(167, 139, 250, 0.15)'
                }}
              />
              <div 
                className="breathing-core"
                style={{
                  transform: `scale(${1 + (breathScale - 1) * 0.3})`,
                  background: breathPhase === 'inhale' 
                    ? 'linear-gradient(135deg, var(--color-secondary) 0%, var(--color-primary) 100%)'
                    : 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%)',
                }}
              >
                <div className="timer-display">
                  {formatTime(timeRemaining)}
                </div>
              </div>
            </div>

            {/* Breath Instruction Prompt */}
            <div className="breath-prompt" style={{ color: breathPhase === 'inhale' ? 'var(--color-secondary)' : 'var(--color-primary)' }}>
              {breathPhase === 'inhale' ? t.breatheIn : t.breatheOut}
            </div>

            {/* Playback Controls Row */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              {/* Mute button */}
              <button
                className="btn btn-secondary"
                onClick={() => setIsMuted(!isMuted)}
                style={{ padding: '0.5rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem', borderRadius: '10px' }}
              >
                {isMuted ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                    {t.unmuteAudio}
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                    {t.muteAudio}
                  </>
                )}
              </button>

              {/* Microphone button (Host) */}
              {isHost && (
                <button 
                  className="btn" 
                  onClick={toggleMicrophone} 
                  style={{ 
                    padding: '0.5rem 1.25rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.35rem',
                    borderRadius: '10px',
                    background: isMicrophoneActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    border: isMicrophoneActive ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                    color: isMicrophoneActive ? '#f87171' : 'var(--color-text-primary)',
                    transform: isMicrophoneActive ? `scale(${1 + (streamingMicLevel / 100) * 0.08})` : undefined,
                    boxShadow: isMicrophoneActive ? `0 0 ${8 + (streamingMicLevel / 100) * 16}px rgba(239, 68, 68, ${0.25 + (streamingMicLevel / 100) * 0.45})` : undefined,
                    transition: 'transform 0.08s ease, box-shadow 0.08s ease, background 0.3s ease, border 0.3s ease'
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                  {isMicrophoneActive ? t.muteMic : t.useMic}
                </button>
              )}
            </div>

            {/* Autoplay Warning Banner */}
            {autoplayBlocked && (
              <div className="glass-panel" style={{ padding: '1rem', border: '1px solid var(--color-primary)', background: 'rgba(167, 139, 250, 0.05)', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center', maxWidth: '300px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-primary)', fontWeight: 600 }}>{t.audioBlocked}</span>
                <button className="btn btn-primary" onClick={forcePlayAudio} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderRadius: '8px' }}>
                  {t.enableSoundSync}
                </button>
              </div>
            )}

            {/* Volume Control Panel */}
            <div 
              className="glass-panel" 
              style={{ 
                marginTop: '1.5rem', 
                padding: showVolumeControls ? '0.85rem 1.25rem' : '0.6rem 1.25rem', 
                display: 'flex', 
                flexDirection: 'column', 
                gap: showVolumeControls ? '0.85rem' : '0', 
                width: '100%', 
                maxWidth: '280px', 
                background: 'rgba(255, 255, 255, 0.02)', 
                border: '1px solid rgba(255, 255, 255, 0.04)', 
                borderRadius: '12px',
                textAlign: 'left',
                transition: 'all 0.3s ease'
              }}
            >
              {/* Header Toggle */}
              <div 
                onClick={() => setShowVolumeControls(!showVolumeControls)}
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  cursor: 'pointer',
                  userSelect: 'none',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: showVolumeControls ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  transition: 'color 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>🎚️</span>
                  <span>{t.soundSettingsTitle}</span>
                </div>
                <span style={{ fontSize: '0.75rem', transform: showVolumeControls ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>
                  ▼
                </span>
              </div>

              {/* Collapsible Content */}
              {showVolumeControls && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '0.15rem' }}>
                  {/* Music Volume Slider */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                      <span>🎵 {t.musicVolumeLabel}</span>
                      <span>{Math.round(musicVolume * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.01" 
                      value={musicVolume} 
                      onChange={(e) => handleMusicVolumeChange(Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                    />
                  </div>

                  {/* Voice Volume Slider */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                      <span>🎙️ {t.voiceVolumeLabel}</span>
                      <span>{Math.round(voiceVolume * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.01" 
                      value={voiceVolume} 
                      onChange={(e) => handleVoiceVolumeChange(Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--color-secondary)', cursor: 'pointer' }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Host Stop Button */}
            {isHost && (
              <button 
                className="btn btn-secondary" 
                onClick={onStopMeditation}
                style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)', padding: '0.6rem 1.5rem', fontSize: '0.9rem', marginTop: '1.25rem' }}
              >
                {t.endSessionEarly}
              </button>
            )}
          </div>
        ) : (
          /* Lobby / Meditation Config Screen */
          <div className="meditation-start-screen">
            <div className="brand-icon" style={{ width: '64px', height: '64px', marginBottom: '1rem' }} />
            <h2>{t.prepareMeditation}</h2>
            
            {isHost ? (
              <div className="lobby-controls" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '360px', margin: '0 auto' }}>
                <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center', fontSize: '0.95rem', marginBottom: '0.5rem' }}>
                  {t.hostInstructions}
                </p>

                {showSettings ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
                    <div className="setting-row">
                      <div className="form-group">
                        <label>{t.durationSetting}</label>
                        <select value={selectedDuration} onChange={(e) => setSelectedDuration(Number(e.target.value))}>
                          {durationOptions.map(val => (
                            <option key={val} value={val}>
                              {getDurationOptionLabel(val)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Dropdown 1: Background Music */}
                    <div className="form-group" style={{ width: '100%' }}>
                      <label>{t.backgroundSoundSetting}</label>
                      <select value={selectedTrackId} onChange={(e) => setSelectedTrackId(e.target.value)}>
                        {ambientTracks.map(tOption => (
                          <option key={tOption.id} value={tOption.id}>
                            {(t as any)[tOption.id] || tOption.title} ({Math.floor(tOption.duration/60)}m)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Dropdown 2: Voice Accompaniment */}
                    <div className="form-group" style={{ width: '100%' }}>
                      <label>🎙️ {t.voiceVolumeLabel}</label>
                      <select value={selectedVoiceTrackId} onChange={(e) => setSelectedVoiceTrackId(e.target.value)}>
                        <option value="live">🎙️ {t.ambientSoundsTab === 'Фоновые звуки' ? 'Живой эфир (микрофон)' : 'Live Mic Stream'}</option>
                        <option value="none">🔇 {t.ambientSoundsTab === 'Фоновые звуки' ? 'Без голоса (только музыка)' : 'No Voice (Music Only)'}</option>
                        {recordedTracks.map(tOption => (
                          <option key={tOption.id} value={tOption.id}>
                            💾 {tOption.title} ({Math.floor(tOption.duration/60)}m {tOption.duration % 60}s)
                          </option>
                        ))}
                      </select>
                    </div>

                    <button 
                      className="btn btn-secondary" 
                      onClick={() => setShowSettings(false)}
                      style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', borderRadius: '10px', alignSelf: 'center', marginTop: '0.5rem' }}
                    >
                      {t.collapseSettings}
                    </button>
                  </div>
                ) : (
                  <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.04)', borderRadius: '12px' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                      {t.selectedSettings}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem' }}>
                        <span>⏱️</span>
                        <span style={{ color: 'var(--color-text-primary)' }}>{getDurationOptionLabel(selectedDuration)}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem' }}>
                        <span>🎵</span>
                        <span style={{ color: 'var(--color-text-primary)' }}>
                          {getTrackTitle(tracks.find(tr => tr.id === selectedTrackId))}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem' }}>
                        <span>🎙️</span>
                        <span style={{ color: 'var(--color-text-primary)' }}>
                          {selectedVoiceTrackId === 'live' 
                            ? (t.ambientSoundsTab === 'Фоновые звуки' ? 'Живой эфир (микрофон)' : 'Live Mic Stream')
                            : selectedVoiceTrackId === 'none'
                            ? (t.ambientSoundsTab === 'Фоновые звуки' ? 'Без голоса (только музыка)' : 'No Voice (Music Only)')
                            : tracks.find(tr => tr.id === selectedVoiceTrackId)?.title}
                        </span>
                      </div>
                    </div>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => setShowSettings(true)}
                      style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', borderRadius: '10px', alignSelf: 'center', marginTop: '0.25rem' }}
                    >
                      {t.changeSettings}
                    </button>
                  </div>
                )}

                <button 
                  className="btn btn-primary" 
                  onClick={() => {
                    const voiceTrackParam = (selectedVoiceTrackId === 'live' || selectedVoiceTrackId === 'none') ? undefined : selectedVoiceTrackId;
                    onStartMeditation(selectedTrackId, selectedDuration, voiceTrackParam);
                  }}
                  style={{ width: '100%', marginTop: '0.5rem', padding: '0.9rem', borderRadius: '12px' }}
                >
                  {t.startSessionBtn}
                </button>

                {isHost && (
                  <button 
                    type="button"
                    className="btn" 
                    onClick={toggleMicrophone} 
                    style={{ 
                      width: '100%', 
                      marginTop: '0.5rem',
                      padding: '0.75rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      gap: '0.35rem',
                      borderRadius: '12px',
                      fontWeight: 600,
                      background: isMicrophoneActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                      border: isMicrophoneActive ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                      color: isMicrophoneActive ? '#f87171' : 'var(--color-text-primary)',
                      transform: isMicrophoneActive ? `scale(${1 + (streamingMicLevel / 100) * 0.08})` : undefined,
                      boxShadow: isMicrophoneActive ? `0 0 ${8 + (streamingMicLevel / 100) * 16}px rgba(239, 68, 68, ${0.25 + (streamingMicLevel / 100) * 0.45})` : undefined,
                      transition: 'transform 0.08s ease, box-shadow 0.08s ease, background 0.3s ease, border 0.3s ease'
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                    {isMicrophoneActive ? t.muteMic : t.useMic}
                  </button>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '1rem' }}>
                  {t.participantWaitPrompt}
                </p>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-primary)', animation: 'pulseLight 1s infinite alternate' }} />
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-primary)', animation: 'pulseLight 1s infinite alternate 0.2s' }} />
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-primary)', animation: 'pulseLight 1s infinite alternate 0.4s' }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Side Panel: Members & Chat */}
      <div className="side-panel">
        {/* Members panel */}
        <div className="glass-panel panel-section">
          <div className="panel-header">{t.participantsTitle} ({roomState.clients.length})</div>
          <div className="member-list">
            {roomState.clients.map((member) => (
              <div key={member.id} className="member-item" style={{ background: member.id === clientId ? 'rgba(255, 255, 255, 0.02)' : 'transparent' }}>
                <div className="user-avatar" style={{ background: member.isHost ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.08)', color: member.isHost ? '#06050e' : 'white' }}>
                  {member.username.charAt(0).toUpperCase()}
                </div>
                <span className="member-name" style={{ fontWeight: member.id === clientId ? 600 : 400 }}>
                  {member.username} {member.id === clientId && t.youTag}
                </span>
                {member.isHost && <span className="member-role">{t.hostTag}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Chat panel */}
        <div className="glass-panel panel-section">
          <div className="panel-header">{t.roomChatTitle}</div>
          <div className="chat-container">
            <div className="chat-messages">
              {messages.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: '0.8rem', textAlign: 'center' }}>
                  {t.chatWelcome}
                </div>
              ) : (
                messages.map((msg, index) => {
                  const isSelf = msg.username === username;
                  return (
                    <div key={index} className={`chat-message ${isSelf ? 'self' : ''}`}>
                      <div className="chat-msg-header">
                        {!isSelf && <span style={{ fontWeight: 600 }}>{msg.username}</span>}
                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="chat-msg-bubble">
                        {msg.text}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            <form onSubmit={handleSendChat} className="chat-input-area">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={t.chatPlaceholder}
                maxLength={100}
              />
              <button type="submit" className="btn btn-primary" style={{ padding: '0.5rem 1rem', borderRadius: '12px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Microphone Selection Modal */}
      {showMicModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <button className="modal-close" onClick={() => { stopMicTest(); setShowMicModal(false); }}>×</button>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white', marginBottom: '0.25rem' }}>
              {t.selectMicTitle}
            </h3>
            
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                {t.selectMicLabel}
              </label>
              <select 
                value={selectedMicId} 
                onChange={(e) => handleMicDeviceChange(e.target.value)}
                style={{ width: '100%', borderRadius: '12px' }}
              >
                {availableMics.map((device, idx) => (
                  <option key={device.deviceId || idx} value={device.deviceId}>
                    {device.label || `${t.deviceDefaultLabel} ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Microphone test peak level bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                <span>🎤 {t.leaveRoom === 'Выйти из комнаты' ? 'Проверка микрофона (говорите):' : 'Microphone Level (Speak):'}</span>
                <span style={{ fontWeight: 600, color: micLevel > 0 ? 'var(--color-secondary)' : 'var(--color-text-secondary)' }}>{micLevel}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                <div 
                  style={{ 
                    width: `${micLevel}%`, 
                    height: '100%', 
                    background: micLevel > 50 
                      ? 'linear-gradient(90deg, var(--color-secondary) 0%, #ef4444 100%)' 
                      : 'linear-gradient(90deg, var(--color-primary) 0%, var(--color-secondary) 100%)',
                    borderRadius: '4px',
                    transition: 'width 0.05s ease'
                  }} 
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => { stopMicTest(); setShowMicModal(false); }}
                style={{ flex: 1, padding: '0.75rem' }}
              >
                {t.cancel}
              </button>
              <button 
                className="btn btn-primary" 
                onClick={() => startMicrophoneWithDevice(selectedMicId)}
                style={{ flex: 1, padding: '0.75rem' }}
              >
                {t.confirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
