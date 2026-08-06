package service

import (
	"errors"
	"net/http"
	"testing"

	"backend/internal/model"
	"backend/pkg"

	"github.com/google/uuid"
)

func TestRequireOwner(t *testing.T) {
	owner := uuid.New()
	other := uuid.New()

	if err := requireOwner(owner, owner); err != nil {
		t.Fatalf("same owner should pass, got %v", err)
	}

	err := requireOwner(owner, other)
	if err == nil {
		t.Fatal("different owner should be rejected")
	}
	var appErr *pkg.AppError
	if !errors.As(err, &appErr) || appErr.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 AppError, got %v", err)
	}
}

func TestOwnerOrNotFound(t *testing.T) {
	owner := uuid.New()
	other := uuid.New()

	if err := ownerOrNotFound(owner, owner); err != nil {
		t.Fatalf("same owner should pass, got %v", err)
	}

	err := ownerOrNotFound(owner, other)
	var appErr *pkg.AppError
	if !errors.As(err, &appErr) || appErr.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 AppError, got %v", err)
	}
}

func TestCheckSessionOwner(t *testing.T) {
	player := uuid.New()
	session := &model.PlaySession{PlayerID: player}

	if err := checkSessionOwner(session, player); err != nil {
		t.Fatalf("owner should pass, got %v", err)
	}

	err := checkSessionOwner(session, uuid.New())
	var appErr *pkg.AppError
	if !errors.As(err, &appErr) || appErr.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for non-owner, got %v", err)
	}
}
