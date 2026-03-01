# Implementation Plan

- [x] 1. Write bug condition exploration tests
  - **Property 1: Fault Condition** - Auto-Close on Start Pattern and EOF Buffer Save
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: These tests encode the expected behavior - they will validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope properties to concrete failing cases for reproducibility
  - Test that consecutive start_patterns (e.g., "START A\nSTART B") create separate entries, not one combined entry
  - Test that EOF with buffered data (e.g., "START session\nline1\nline2" with no END) saves the buffer as an entry
  - Test that triple consecutive starts (e.g., "START A\nSTART B\nSTART C") create three separate entries
  - Test that mixed pattern (e.g., "START A\nline1\nSTART B\nline2\nEND B") creates two entries with correct content
  - Run tests on UNFIXED code (index.html with original tick() function)
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bug exists)
  - Document counterexamples found:
    - Entries array has fewer items than expected
    - Buffer accumulates multiple start_pattern lines
    - Sessions without end_pattern at EOF are not saved
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Normal Flow Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (normal sessions with END patterns)
  - Test that normal session flow "START\nlines\nEND" continues to work correctly
  - Test that EOF with empty buffer (inBlock=false) calls finishParsing() normally
  - Test that end_pattern handling saves complete sessions correctly
  - Test that line buffering for non-start/end lines works correctly
  - Test that progress updates and counter tracking remain accurate
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for start_pattern auto-close and EOF buffer handling

  - [x] 3.1 Modify start pattern condition (line 545)
    - Change condition from `if (isS && !inBlock)` to `if (isS)`
    - This allows start_pattern handling regardless of inBlock state
    - Enables auto-close behavior when already in a block
    - _Bug_Condition: isBugCondition(input) where input.isStartPattern=true AND input.inBlock=true AND input.buffer.length>0_
    - _Expected_Behavior: Auto-close current session, save buffer via parseBlock(), reset state, start new session_
    - _Preservation: Normal start pattern handling when inBlock=false must remain unchanged (Property 3)_
    - _Requirements: 2.1, 3.1_

  - [x] 3.2 Add auto-close logic within if (isS) block
    - Add conditional check: IF inBlock=true AND buffer.length > 0
    - Save current session: call parseBlock(buffer, bufferLines), push result to entries array
    - Update counters: increment found++ and matched++
    - Reset state: buffer=[], bufferLines=[], inBlock=false
    - THEN proceed with normal start logic: buffer=[t], bufferLines=[idx+1], inBlock=true
    - _Bug_Condition: isBugCondition(input) where input.isStartPattern=true AND input.inBlock=true AND input.buffer.length>0_
    - _Expected_Behavior: Current buffer saved as entry, new session starts fresh with new start_pattern line_
    - _Preservation: End pattern handling, line buffering, and normal EOF handling must remain unchanged (Properties 4, 5, 6)_
    - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.3 Add EOF buffer check (line 559)
    - Modify else branch from `else { finishParsing(); }` to check for buffered data
    - Add conditional check: IF inBlock=true AND buffer.length > 0
    - Save buffered session: call parseBlock(buffer, bufferLines), push result to entries array
    - Update counters: increment found++ and matched++
    - THEN call finishParsing()
    - _Bug_Condition: isBugCondition(input) where input.isEOF=true AND input.inBlock=true AND input.buffer.length>0_
    - _Expected_Behavior: Buffered session saved as entry before finishParsing() is called_
    - _Preservation: Normal EOF handling with empty buffer must remain unchanged (Property 6)_
    - _Requirements: 2.2, 3.4_

  - [x] 3.4 Verify bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Auto-Close and EOF Save Working
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the expected behavior
    - When these tests pass, it confirms the expected behavior is satisfied
    - Run bug condition exploration tests from step 1
    - Verify consecutive start_patterns create separate entries
    - Verify EOF with buffered data saves the buffer
    - Verify triple consecutive starts create three entries
    - Verify mixed pattern creates correct entries
    - **EXPECTED OUTCOME**: Tests PASS (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Normal Flow Still Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - Verify normal session flow with END patterns still works
    - Verify EOF with empty buffer still works
    - Verify end_pattern handling unchanged
    - Verify line buffering unchanged
    - Verify progress updates unchanged
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
