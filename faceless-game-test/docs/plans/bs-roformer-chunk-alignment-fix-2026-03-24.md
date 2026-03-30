# Plan: Fix BS-RoFormer Chunk Mismatch Crash

Date: 2026-03-24

## Problem
Worker crashes during inference with:
`RuntimeError: The size of tensor a (881664) must match the size of tensor b (882000)`

## Root Cause
`audio.chunk_size` override was set to `882000`, but BS-RoFormer output length is quantized by model hop size (`stft_hop_length`, 512 for this model). Non-aligned chunk sizes cause overlap-add tensor mismatch.

## Fix
1. In worker config override path, align requested chunk size to a valid multiple of model hop size.
2. Log requested and effective values so mismatches are explicit.
3. Set env default to a hop-aligned value (`881664`) to avoid unnecessary runtime adjustment.

## Validation
- Rebuild/restart worker.
- Run separation job and confirm:
  - no tensor size mismatch
  - logs show aligned chunk size and successful completion.
