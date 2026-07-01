package room

import (
	"testing"
	"time"
)

func TestCompletingRoomRemovesScheduledEvent(t *testing.T) {
	db := InitDB(":memory:")
	defer db.Close()

	event := MeditationEvent{
		ID:           "event-finish-test",
		Title:        "Evening practice",
		HostUsername: "alice",
		RoomID:       "scheduled-room",
		StartsAt:     time.Now().UnixMilli(),
		Duration:     1200,
	}
	if err := CreateMeditationEvent(event); err != nil {
		t.Fatalf("create event: %v", err)
	}
	if err := SetMeditationEventAttendance(event.ID, "alice", true); err != nil {
		t.Fatalf("add attendance: %v", err)
	}
	if err := CompleteMeditationEventByRoom(event.RoomID); err != nil {
		t.Fatalf("complete event: %v", err)
	}

	events, err := ListMeditationEvents("alice")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("expected completed event to disappear, got %+v", events)
	}

	var attendeeCount int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM meditation_event_attendees WHERE event_id = ?",
		event.ID,
	).Scan(&attendeeCount); err != nil {
		t.Fatalf("count attendees: %v", err)
	}
	if attendeeCount != 0 {
		t.Fatalf("expected attendee cleanup, got %d", attendeeCount)
	}
}
