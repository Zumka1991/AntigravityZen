package room

import "testing"

func TestBackgroundLifecycle(t *testing.T) {
	db := InitDB(":memory:")
	defer db.Close()

	InitBackgrounds()
	backgrounds := GetBackgrounds()
	if len(backgrounds) != len(defaultMeditationBackgrounds) {
		t.Fatalf("expected %d default backgrounds, got %d", len(defaultMeditationBackgrounds), len(backgrounds))
	}

	custom, err := AddBackground("Northern Lights", "/uploads/backgrounds/aurora.webp", "admin")
	if err != nil {
		t.Fatalf("add custom background: %v", err)
	}
	if custom.IsDefault {
		t.Fatal("custom background must not be marked as default")
	}
	if found := FindBackground(custom.ID); found == nil || found.ImageURL != custom.ImageURL {
		t.Fatalf("custom background not found: %+v", found)
	}

	if err := DeleteBackground(defaultMeditationBackgrounds[0].ID); err == nil {
		t.Fatal("default background should not be deletable")
	}
	if err := DeleteBackground(custom.ID); err != nil {
		t.Fatalf("delete custom background: %v", err)
	}
}
