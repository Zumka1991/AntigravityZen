package room

import (
	"encoding/binary"
	"flag"
	"log"
	"math"
	"math/rand"
	"os"
	"path/filepath"
)

// ensureDefaultTrackAudioFiles generates the 7 built-in ambient WAV files under
// ./uploads if they are missing on disk (for example on a fresh Docker volume).
func ensureDefaultTrackAudioFiles(tracks []Track) {
	if flag.Lookup("test.v") != nil {
		return
	}
	if err := os.MkdirAll("./uploads", 0o755); err != nil {
		log.Printf("Could not create uploads directory for default tracks: %v", err)
		return
	}

	for _, tr := range tracks {
		rel := filepath.Base(tr.AudioURL)
		if rel == "" || rel == "." {
			continue
		}
		targetPath := filepath.Join("./uploads", rel)
		if info, err := os.Stat(targetPath); err == nil && info.Size() > 4096 {
			continue
		}
		duration := tr.Duration
		if duration <= 0 {
			duration = 90
		}
		if err := generateAmbientWAV(targetPath, tr.ID, duration); err != nil {
			log.Printf("Failed to synthesize default track %s (%s): %v", tr.ID, targetPath, err)
		} else {
			log.Printf("Synthesized default ambient track: %s (%s)", tr.Title, targetPath)
		}
	}
}

func generateAmbientWAV(path, trackID string, durationSec int) error {
	const (
		sampleRate = 22050
		channels   = 2
		bits       = 16
	)
	totalSamples := sampleRate * durationSec
	dataSize := totalSamples * channels * (bits / 8)

	tmpPath := path + ".tmp"
	f, err := os.Create(tmpPath)
	if err != nil {
		return err
	}
	defer func() {
		_ = f.Close()
		_ = os.Remove(tmpPath)
	}()

	// Write standard 44-byte RIFF WAVE header
	header := make([]byte, 44)
	copy(header[0:4], "RIFF")
	binary.LittleEndian.PutUint32(header[4:8], uint32(36+dataSize))
	copy(header[8:12], "WAVE")
	copy(header[12:16], "fmt ")
	binary.LittleEndian.PutUint32(header[16:20], 16)
	binary.LittleEndian.PutUint16(header[20:22], 1) // PCM
	binary.LittleEndian.PutUint16(header[22:24], channels)
	binary.LittleEndian.PutUint32(header[24:28], sampleRate)
	binary.LittleEndian.PutUint32(header[28:32], uint32(sampleRate*channels*(bits/8)))
	binary.LittleEndian.PutUint16(header[32:34], uint16(channels*(bits/8)))
	binary.LittleEndian.PutUint16(header[34:36], bits)
	copy(header[36:40], "data")
	binary.LittleEndian.PutUint32(header[40:44], uint32(dataSize))

	if _, err := f.Write(header); err != nil {
		return err
	}

	rng := rand.New(rand.NewSource(108_432 + int64(len(trackID))))
	var lpL, lpR, brownL, brownR float64

	const chunkFrames = 4096
	buf := make([]byte, chunkFrames*channels*2)

	fadeSamples := sampleRate * 3 // 3s smooth fade in/out for seamless looping

	for base := 0; base < totalSamples; base += chunkFrames {
		frames := chunkFrames
		if base+frames > totalSamples {
			frames = totalSamples - base
		}

		for i := 0; i < frames; i++ {
			sampleIdx := base + i
			t := float64(sampleIdx) / float64(sampleRate)

			// Smooth loop envelope
			env := 1.0
			if sampleIdx < fadeSamples {
				env = 0.5 * (1.0 - math.Cos(math.Pi*float64(sampleIdx)/float64(fadeSamples)))
			} else if sampleIdx > totalSamples-fadeSamples {
				rem := totalSamples - sampleIdx
				env = 0.5 * (1.0 - math.Cos(math.Pi*float64(rem)/float64(fadeSamples)))
			}

			whiteL := rng.Float64()*2 - 1
			whiteR := rng.Float64()*2 - 1
			brownL = (brownL + 0.02*whiteL) / 1.02
			brownR = (brownR + 0.02*whiteR) / 1.02
			lpL += 0.08 * (whiteL - lpL)
			lpR += 0.08 * (whiteR - lpR)

			var left, right float64

			switch trackID {
			case "ambient-rain":
				// Soft rain texture + distant warm thunder swells + subtle harmonic bed
				rainL := lpL*0.22 + brownL*0.45
				rainR := lpR*0.22 + brownR*0.45
				thunder := math.Pow(math.Max(0, math.Sin(2*math.Pi*t/19.0)*math.Sin(2*math.Pi*t/7.3)), 3)
				rumble := brownL * thunder * 0.75
				pad := 0.04*math.Sin(2*math.Pi*110.0*t) + 0.03*math.Sin(2*math.Pi*165.0*t)
				left = rainL + rumble + pad
				right = rainR + rumble*0.9 + pad

			case "tibetan-bowls":
				// Singing bowl harmonic cycles with natural beating partials
				freqs := []float64{174.0, 285.0, 396.0, 528.0}
				for idx, f0 := range freqs {
					cycle := 14.0 + float64(idx)*3.5
					phase := math.Mod(t+float64(idx)*3.1, cycle)
					attack := 1.0 - math.Exp(-phase*3.5)
					decay := math.Exp(-phase * 0.24)
					amp := attack * decay * 0.14
					tone := math.Sin(2*math.Pi*f0*t) +
						0.35*math.Sin(2*math.Pi*(f0*2.71)*t)*math.Exp(-phase*0.55) +
						0.15*math.Sin(2*math.Pi*(f0*0.5)*t)
					pan := 0.5 + 0.3*math.Sin(2*math.Pi*0.07*t+float64(idx))
					left += tone * amp * pan
					right += tone * amp * (1.0 - pan*0.5)
				}

			case "deep-relaxation":
				// Warm slow-breathing astral chord pad (Cmaj9 / Fmaj7 voicings)
				notesL := []float64{130.81, 164.81, 196.00, 246.94, 293.66}
				notesR := []float64{131.05, 164.60, 196.25, 246.70, 293.90}
				breath := 0.65 + 0.35*math.Sin(2*math.Pi*t/10.0)
				for idx := range notesL {
					mod := 0.7 + 0.3*math.Sin(2*math.Pi*(0.05+float64(idx)*0.017)*t+float64(idx))
					left += 0.085 * mod * breath * math.Sin(2*math.Pi*notesL[idx]*t)
					right += 0.085 * mod * breath * math.Sin(2*math.Pi*notesR[idx]*t)
				}
				left += brownL * 0.08
				right += brownR * 0.08

			case "ocean-waves":
				// Rolling ocean surf with 9-second wave period and gentle stereo sweep
				waveL := 0.5 + 0.5*math.Sin(2*math.Pi*t/9.0)
				waveR := 0.5 + 0.5*math.Sin(2*math.Pi*t/9.0-0.35)
				crestL := math.Pow(waveL, 2.2)
				crestR := math.Pow(waveR, 2.2)
				drone := 0.05*math.Sin(2*math.Pi*98.0*t) + 0.035*math.Sin(2*math.Pi*147.0*t)
				left = (brownL*0.55 + lpL*0.28*crestL) * (0.28 + 0.72*crestL) + drone
				right = (brownR*0.55 + lpR*0.28*crestR) * (0.28 + 0.72*crestR) + drone

			case "cosmic-drone":
				// Deep 108 Hz Om / fifth drone with slow harmonic shimmer
				baseFreq := 108.0
				shimmer1 := 0.5 + 0.5*math.Sin(2*math.Pi*0.06*t)
				shimmer2 := 0.5 + 0.5*math.Cos(2*math.Pi*0.043*t)
				left = 0.18*math.Sin(2*math.Pi*baseFreq*t) +
					0.12*math.Sin(2*math.Pi*(baseFreq*1.5)*t) +
					0.08*shimmer1*math.Sin(2*math.Pi*(baseFreq*2.002)*t) +
					0.04*shimmer2*math.Sin(2*math.Pi*(baseFreq*3.0)*t) +
					brownL*0.06
				right = 0.18*math.Sin(2*math.Pi*(baseFreq+0.35)*t) +
					0.12*math.Sin(2*math.Pi*(baseFreq*1.5-0.25)*t) +
					0.08*shimmer2*math.Sin(2*math.Pi*(baseFreq*1.998)*t) +
					0.04*shimmer1*math.Sin(2*math.Pi*(baseFreq*3.003)*t) +
					brownR*0.06

			case "binaural-beats":
				// True 6 Hz Theta binaural beat (200 Hz Left / 206 Hz Right) + warm sub pad
				sub := 0.09*math.Sin(2*math.Pi*100.0*t) + 0.05*math.Sin(2*math.Pi*150.0*t)
				left = 0.22*math.Sin(2*math.Pi*200.0*t) + sub + brownL*0.05
				right = 0.22*math.Sin(2*math.Pi*206.0*t) + sub + brownR*0.05

			default: // "forest-night" and any other default track
				// Soft night breeze + warm campfire crackle + gentle harmonic crickets/chimes
				breeze := 0.4 + 0.6*(0.5+0.5*math.Sin(2*math.Pi*t/13.0))
				chirpEnv := math.Pow(math.Max(0, math.Sin(2*math.Pi*3.2*t)*math.Sin(2*math.Pi*0.23*t)), 4)
				chirp := 0.025 * chirpEnv * math.Sin(2*math.Pi*2850.0*t)
				warmChord := 0.07*math.Sin(2*math.Pi*146.83*t) + 0.05*math.Sin(2*math.Pi*220.0*t) + 0.04*math.Sin(2*math.Pi*293.66*t)
				left = brownL*0.32*breeze + lpL*0.09 + warmChord + chirp
				right = brownR*0.32*breeze + lpR*0.09 + warmChord + chirp*0.8
			}

			left = clampSample(left * env * 0.85)
			right = clampSample(right * env * 0.85)

			sL := int16(left * 32760)
			sR := int16(right * 32760)
			offset := i * 4
			binary.LittleEndian.PutUint16(buf[offset:offset+2], uint16(sL))
			binary.LittleEndian.PutUint16(buf[offset+2:offset+4], uint16(sR))
		}

		if _, err := f.Write(buf[:frames*4]); err != nil {
			return err
		}
	}

	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

func clampSample(v float64) float64 {
	if v > 1.0 {
		return 1.0
	}
	if v < -1.0 {
		return -1.0
	}
	return v
}
