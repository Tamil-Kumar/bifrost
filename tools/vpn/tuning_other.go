//go:build !windows

package main

func platformKnob(string) bool { return false }

var stdBind bool
