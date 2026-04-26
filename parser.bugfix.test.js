/**
 * Bug Condition Exploration Tests for Start Pattern Auto-Close
 * 
 * **Validates: Requirements 2.1, 2.2**
 * 
 * CRITICAL: These tests MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 * 
 * These tests encode the expected behavior - they will validate the fix when they pass after implementation
 * GOAL: Surface counterexamples that demonstrate the bug exists
 */

const fc = require('fast-check');
const { createParser } = require('./parser');

// Test configuration matching pattern_config.json
const TEST_CONFIG = {
  start_patterns: ['START'],
  end_patterns: ['END'],
  success_patterns: ['SUCCESS'],
  failure_patterns: [],
  clickable_patterns: {},
  utterance_patterns: {},
  pattern_groups: {}
};

describe('Bug Condition Exploration - Start Pattern Auto-Close', () => {
  
  /**
   * Property 1: Fault Condition - Auto-Close on Start Pattern
   * **Validates: Requirements 2.1**
   * 
   * Test that consecutive start_patterns create separate entries, not one combined entry
   */
  describe('Consecutive Start Patterns', () => {
    
    test('Two consecutive starts should create two separate entries', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nSTART B';
      
      const result = parser.parseText(logText);
      
      // EXPECTED: 2 entries (one for "START A", one for "START B")
      // ACTUAL ON UNFIXED CODE: 1 entry with both lines combined
      expect(result.entries.length).toBe(2);
      expect(result.entries[0].allLines).toEqual(['START A']);
      expect(result.entries[1].allLines).toEqual(['START B']);
    });

    test('Three consecutive starts should create three separate entries', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nSTART B\nSTART C';
      
      const result = parser.parseText(logText);
      
      // EXPECTED: 3 entries
      // ACTUAL ON UNFIXED CODE: 1 entry with all three lines
      expect(result.entries.length).toBe(3);
      expect(result.entries[0].allLines).toEqual(['START A']);
      expect(result.entries[1].allLines).toEqual(['START B']);
      expect(result.entries[2].allLines).toEqual(['START C']);
    });

    test('Mixed pattern: START A, line1, START B, line2, END B should create two entries', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nline1\nSTART B\nline2\nEND B';
      
      const result = parser.parseText(logText);
      
      // EXPECTED: 2 entries
      //   Entry 1: ["START A", "line1"] (auto-closed by START B)
      //   Entry 2: ["START B", "line2", "END B"] (normal close)
      // ACTUAL ON UNFIXED CODE: 1 entry with all lines, START A is lost
      expect(result.entries.length).toBe(2);
      expect(result.entries[0].allLines).toEqual(['START A', 'line1']);
      expect(result.entries[1].allLines).toEqual(['START B', 'line2', 'END B']);
    });

    test('Property: Consecutive starts always create N separate entries', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }), // Number of consecutive starts
          (numStarts) => {
            const parser = createParser(TEST_CONFIG);
            const lines = [];
            for (let i = 0; i < numStarts; i++) {
              lines.push(`START session${i}`);
            }
            const logText = lines.join('\n');
            
            const result = parser.parseText(logText);
            
            // EXPECTED: numStarts entries
            // ACTUAL ON UNFIXED CODE: 1 entry with all starts combined
            expect(result.entries.length).toBe(numStarts);
            
            // Each entry should contain only its own start line
            for (let i = 0; i < numStarts; i++) {
              expect(result.entries[i].allLines).toEqual([`START session${i}`]);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  /**
   * Property 2: Fault Condition - Save Buffer at EOF
   * **Validates: Requirements 2.2**
   * 
   * Test that EOF with buffered data saves the buffer as an entry
   */
  describe('EOF with Buffered Data', () => {
    
    test('START with lines but no END should save buffer at EOF', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START session\nline1\nline2';
      
      const result = parser.parseText(logText);
      
      // EXPECTED: 1 entry with all three lines
      // ACTUAL ON UNFIXED CODE: 0 entries, buffer is discarded
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].allLines).toEqual(['START session', 'line1', 'line2']);
    });

    test('Single START line at EOF should save as entry', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START session';
      
      const result = parser.parseText(logText);
      
      // EXPECTED: 1 entry with the start line
      // ACTUAL ON UNFIXED CODE: 0 entries
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].allLines).toEqual(['START session']);
    });

    test('Multiple sessions with last one missing END should save all', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nline1\nEND A\nSTART B\nline2';
      
      const result = parser.parseText(logText);
      
      // EXPECTED: 2 entries
      //   Entry 1: ["START A", "line1", "END A"] (normal close)
      //   Entry 2: ["START B", "line2"] (EOF save)
      // ACTUAL ON UNFIXED CODE: 1 entry, second session is lost
      expect(result.entries.length).toBe(2);
      expect(result.entries[0].allLines).toEqual(['START A', 'line1', 'END A']);
      expect(result.entries[1].allLines).toEqual(['START B', 'line2']);
    });

    test('Property: Sessions without END at EOF are always saved', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }), // Number of lines after START
          (numLines) => {
            const parser = createParser(TEST_CONFIG);
            const lines = ['START session'];
            for (let i = 0; i < numLines; i++) {
              lines.push(`line${i}`);
            }
            const logText = lines.join('\n');
            
            const result = parser.parseText(logText);
            
            // EXPECTED: 1 entry with all lines
            // ACTUAL ON UNFIXED CODE: 0 entries
            expect(result.entries.length).toBe(1);
            expect(result.entries[0].allLines.length).toBe(numLines + 1);
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  /**
   * Combined Fault Conditions
   * Tests that combine both bug conditions
   */
  describe('Combined Bug Conditions', () => {
    
    test('Multiple consecutive starts at EOF without END should save all', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nSTART B\nSTART C';
      
      const result = parser.parseText(logText);
      
      // EXPECTED: 3 entries (consecutive starts + EOF save)
      // ACTUAL ON UNFIXED CODE: 0 entries (both bugs manifest)
      expect(result.entries.length).toBe(3);
    });

    test('Normal session followed by consecutive starts at EOF', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nEND A\nSTART B\nSTART C';
      
      const result = parser.parseText(logText);
      
      // EXPECTED: 3 entries
      // ACTUAL ON UNFIXED CODE: 1 entry (only the first normal session)
      expect(result.entries.length).toBe(3);
      expect(result.entries[0].allLines).toEqual(['START A', 'END A']);
      expect(result.entries[1].allLines).toEqual(['START B']);
      expect(result.entries[2].allLines).toEqual(['START C']);
    });
  });

  /**
   * Internal State Verification
   * These tests verify the internal state to understand the bug mechanism
   */
  describe('Internal State Verification (Bug Mechanism)', () => {
    
    test('Consecutive starts: buffer accumulates multiple start lines', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START A\nSTART B';
      
      const result = parser.parseText(logText);
      
      // On unfixed code, the buffer should contain both start lines
      // because the second START is treated as a regular line
      if (result.entries.length < 2) {
        // Bug confirmed: buffer accumulated multiple starts
        expect(result.finalBuffer.length).toBeGreaterThan(1);
        expect(result.finalInBlock).toBe(true);
      }
    });

    test('EOF with buffer: inBlock remains true and buffer is not empty', () => {
      const parser = createParser(TEST_CONFIG);
      const logText = 'START session\nline1';
      
      const result = parser.parseText(logText);
      
      // On unfixed code, buffer should still contain data at EOF
      if (result.entries.length === 0) {
        // Bug confirmed: buffer was not saved at EOF
        expect(result.finalInBlock).toBe(true);
        expect(result.finalBuffer.length).toBeGreaterThan(0);
      }
    });
  });
});
