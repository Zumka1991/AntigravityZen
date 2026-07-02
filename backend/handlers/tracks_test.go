package handlers

import "testing"

func TestParseTrackSources(t *testing.T) {
	sources, err := parseTrackSources(`[
		{"label":"Сайт Ливанды","url":"https://livanda.example/meditation"},
		{"label":"YouTube","url":"https://youtube.com/watch?v=123"}
	]`)
	if err != nil {
		t.Fatalf("parseTrackSources returned an error: %v", err)
	}
	if len(sources) != 2 {
		t.Fatalf("expected 2 sources, got %d", len(sources))
	}
	if sources[0].Label != "Сайт Ливанды" {
		t.Fatalf("unexpected first source: %+v", sources[0])
	}
}

func TestParseTrackSourcesRejectsUnsafeURL(t *testing.T) {
	_, err := parseTrackSources(`[{"label":"Bad link","url":"javascript:alert(1)"}]`)
	if err == nil {
		t.Fatal("expected unsafe source URL to be rejected")
	}
}

func TestParseTrackSourcesSkipsEmptyRows(t *testing.T) {
	sources, err := parseTrackSources(`[{"label":" ","url":" "}]`)
	if err != nil {
		t.Fatalf("empty row should not return an error: %v", err)
	}
	if len(sources) != 0 {
		t.Fatalf("expected no sources, got %d", len(sources))
	}
}
