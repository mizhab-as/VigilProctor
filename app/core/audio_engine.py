import sounddevice as sd
import numpy as np
import queue
import threading

class AudioAnomalyDetector:
    def __init__(self, sample_rate=16000, block_size=1024, history_size=100, fallback_threshold=0.05):
        self.sample_rate = sample_rate
        self.block_size = block_size
        self.history_size = history_size
        self.fallback_threshold = fallback_threshold
        
        self.q = queue.Queue()
        self.stream = None
        self.is_running = False
        
        self.energy_history = []
        self.lock = threading.Lock()
        
        # Audio level tracking for UI visual meter
        self.current_amplitude = 0.0

    def _audio_callback(self, indata, frames, time_info, status):
        """This is called for each audio block from sounddevice."""
        if status:
            pass
        # Copy the raw input buffer to queue for FFT analysis
        self.q.put(indata.copy())
        # Track raw RMS for real-time visual UI levels
        rms = np.sqrt(np.mean(indata**2))
        self.current_amplitude = float(rms)

    def start(self):
        """Starts recording audio from the default input device."""
        if self.is_running:
            return
        self.is_running = True
        try:
            self.stream = sd.InputStream(
                samplerate=self.sample_rate,
                blocksize=self.block_size,
                channels=1,
                callback=self._audio_callback
            )
            self.stream.start()
            print("[AUDIO ENGINE] Microphonic listener tracking activated successfully.")
        except Exception as e:
            print(f"[AUDIO ENGINE ERROR] Failed to initialize default audio input device: {e}")
            self.is_running = False

    def stop(self):
        """Stops the audio recording stream."""
        self.is_running = False
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None
            print("[AUDIO ENGINE] Audio tracking stream terminated.")

    def get_current_level(self):
        """Returns normalized amplitude (0-100) scaled for UI visualization."""
        # Convert RMS value to 0-100 range. Silent room is ~0.002, normal talking is ~0.05 to 0.15
        # Multiplier of 400 maps normal ranges nicely
        return min(int(self.current_amplitude * 400), 100)

    def check_for_anomaly(self):
        """
        Polls the queue for audio chunks, updates noise-floor history, 
        performs spectral FFT, and detects speech or general acoustic anomalies.
        """
        anomalies = []
        while not self.q.empty():
            indata = self.q.get()
            rms = np.sqrt(np.mean(indata**2))
            
            with self.lock:
                self.energy_history.append(rms)
                if len(self.energy_history) > self.history_size:
                    self.energy_history.pop(0)
                
                # Dynamic Threshold calculation: T = mean + 2.5 * std
                if len(self.energy_history) >= 10:
                    mean_val = np.mean(self.energy_history)
                    std_val = np.std(self.energy_history)
                    threshold = mean_val + 2.5 * std_val
                else:
                    threshold = self.fallback_threshold
                
                # Ensure threshold doesn't lock at extreme silence
                threshold = max(threshold, 0.015)

                # Anomaly triggers if RMS exceeds dynamic threshold and minimum loudness limit
                if rms > threshold and rms > 0.02:
                    # Perform Fast Fourier Transform to analyze frequency bands
                    n = len(indata)
                    fft_vals = np.abs(np.fft.rfft(indata.flatten()))
                    freqs = np.fft.rfftfreq(n, d=1.0/self.sample_rate)
                    
                    # Human speech and whisper frequency band (300Hz to 3000Hz)
                    speech_mask = (freqs >= 300) & (freqs <= 3000)
                    speech_energy = np.sum(fft_vals[speech_mask]**2)
                    total_energy = np.sum(fft_vals**2) + 1e-6
                    
                    speech_ratio = speech_energy / total_energy
                    
                    # Whispering/talking has higher energy concentration in voice band
                    if speech_ratio > 0.40:
                        confidence = min(0.65 + (rms - threshold) * 3 + speech_ratio * 0.2, 0.99)
                        anomalies.append({
                            "type": "Acoustic Deviation (Speech/Whisper)",
                            "confidence": confidence
                        })
                    else:
                        confidence = min(0.50 + (rms - threshold) * 2.5, 0.95)
                        anomalies.append({
                            "type": "Acoustic Deviation (Noise)",
                            "confidence": confidence
                        })
        return anomalies
