package room

import (
	"sync"
	"time"
)

type RateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*bucket
	rate     time.Duration
	capacity int
}

type bucket struct {
	tokens    float64
	lastCheck time.Time
}

// NewRateLimiter creates a new thread-safe token bucket rate limiter
func NewRateLimiter(rate time.Duration, capacity int) *RateLimiter {
	rl := &RateLimiter{
		buckets:  make(map[string]*bucket),
		rate:     rate,
		capacity: capacity,
	}
	go rl.cleanupLoop()
	return rl
}

// Allow checks if the request under the specified key is allowed
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, exists := rl.buckets[key]
	if !exists {
		rl.buckets[key] = &bucket{
			tokens:    float64(rl.capacity - 1),
			lastCheck: now,
		}
		return true
	}

	elapsed := now.Sub(b.lastCheck)
	b.lastCheck = now

	b.tokens += float64(elapsed) / float64(rl.rate)
	if b.tokens > float64(rl.capacity) {
		b.tokens = float64(rl.capacity)
	}

	if b.tokens >= 1.0 {
		b.tokens -= 1.0
		return true
	}
	return false
}

func (rl *RateLimiter) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		for key, b := range rl.buckets {
			if now.Sub(b.lastCheck) > 10*time.Minute {
				delete(rl.buckets, key)
			}
		}
		rl.mu.Unlock()
	}
}

// Global rate limiters configuration
var (
	AuthIPRateLimiter       = NewRateLimiter(2*time.Second, 5)
	DMRateLimiter           = NewRateLimiter(2*time.Second, 5)
	GlobalChatRateLimiter   = NewRateLimiter(2*time.Second, 5)
	RoomChatRateLimiter     = NewRateLimiter(1*time.Second, 10)
	RoomAccessRateLimiter   = NewRateLimiter(1*time.Second, 10)
	TrackUploadRateLimiter  = NewRateLimiter(20*time.Minute, 3)
)
