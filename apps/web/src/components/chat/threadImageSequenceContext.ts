// FILE: threadImageSequenceContext.ts
// Purpose: Gives a tool row's image thumbnails the thread's whole snapshot sequence, so
//          expanding one figure can step through every version the agent looked at.
// Layer: Chat transcript context
// Exports: ThreadImageSequenceContext

import { createContext } from "react";

import type { ThreadImageSequenceItem } from "~/lib/workEntryImages";

/** Snapshot images in transcript order; empty outside a transcript. */
export const ThreadImageSequenceContext = createContext<ReadonlyArray<ThreadImageSequenceItem>>([]);
