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

func TestLateHostEventRemainsVisible(t *testing.T) {
	db := InitDB(":memory:")
	defer db.Close()

	event := MeditationEvent{
		ID:           "late-host-event",
		Title:        "Short practice",
		HostUsername: "alice",
		RoomID:       "late-host-room",
		StartsAt:     time.Now().Add(-10 * time.Minute).UnixMilli(),
		Duration:     60,
	}
	if err := CreateMeditationEvent(event); err != nil {
		t.Fatalf("create late event: %v", err)
	}

	events, err := ListMeditationEvents("alice")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(events) != 1 || events[0].ID != event.ID {
		t.Fatalf("late host should still have a chance to start, got %+v", events)
	}
}

func TestAbandonedEventIsRemovedAfterOneHour(t *testing.T) {
	db := InitDB(":memory:")
	defer db.Close()

	event := MeditationEvent{
		ID:           "abandoned-event",
		Title:        "Missed practice",
		HostUsername: "alice",
		RoomID:       "abandoned-room",
		StartsAt:     time.Now().Add(-61 * time.Minute).UnixMilli(),
		Duration:     600,
	}
	if err := CreateMeditationEvent(event); err != nil {
		t.Fatalf("create event: %v", err)
	}
	if err := SetMeditationEventAttendance(event.ID, "alice", true); err != nil {
		t.Fatalf("add attendance: %v", err)
	}

	hub := NewHub()
	deleted, err := hub.PruneAbandonedMeditationEvents(time.Now())
	if err != nil {
		t.Fatalf("prune abandoned events: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("expected one deleted event, got %d", deleted)
	}

	events, err := ListMeditationEvents("alice")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("expected abandoned event to disappear, got %+v", events)
	}
}

func TestOldEventStaysWhileHostIsPresent(t *testing.T) {
	db := InitDB(":memory:")
	defer db.Close()

	event := MeditationEvent{
		ID:           "present-host-event",
		Title:        "Active lobby",
		HostUsername: "alice",
		RoomID:       "present-host-room",
		StartsAt:     time.Now().Add(-2 * time.Hour).UnixMilli(),
		Duration:     600,
	}
	if err := CreateMeditationEvent(event); err != nil {
		t.Fatalf("create event: %v", err)
	}

	hub := NewHub()
	host := &Client{Username: "alice"}
	hub.Rooms[event.RoomID] = &Room{
		ID:           event.RoomID,
		HostUsername: event.HostUsername,
		Status:       "lobby",
		Clients:      map[*Client]bool{host: true},
	}

	deleted, err := hub.PruneAbandonedMeditationEvents(time.Now())
	if err != nil {
		t.Fatalf("prune abandoned events: %v", err)
	}
	if deleted != 0 {
		t.Fatalf("expected host's event to remain, deleted %d", deleted)
	}
}

func TestPlayingEventStaysDuringHostReconnect(t *testing.T) {
	db := InitDB(":memory:")
	defer db.Close()

	event := MeditationEvent{
		ID:           "playing-event",
		Title:        "Long practice",
		HostUsername: "alice",
		RoomID:       "playing-room",
		StartsAt:     time.Now().Add(-2 * time.Hour).UnixMilli(),
		Duration:     10800,
	}
	if err := CreateMeditationEvent(event); err != nil {
		t.Fatalf("create event: %v", err)
	}

	hub := NewHub()
	hub.Rooms[event.RoomID] = &Room{
		ID:           event.RoomID,
		HostUsername: event.HostUsername,
		Status:       "playing",
		Clients:      make(map[*Client]bool),
	}

	deleted, err := hub.PruneAbandonedMeditationEvents(time.Now())
	if err != nil {
		t.Fatalf("prune abandoned events: %v", err)
	}
	if deleted != 0 {
		t.Fatalf("expected playing event to remain, deleted %d", deleted)
	}
}
