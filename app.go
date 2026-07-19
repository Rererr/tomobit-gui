package main

import (
	"context"
	"fmt"
)

type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// TurnReply is Tomo's reply to a single chat turn.
type TurnReply struct {
	Text string `json:"text"`
}

// SendTurn is a placeholder for the `tomobit chat` pipe-mode wiring (ADR-0001
// Decision 2). It does not call any Provider yet.
func (a *App) SendTurn(text string) (TurnReply, error) {
	return TurnReply{
		Text: fmt.Sprintf("（未配線）「%s」を受け取りました。Provider配線は別タスクで行います。", text),
	}, nil
}
