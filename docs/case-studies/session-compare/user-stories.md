# Session Compare User Stories

## Story 1: Start a Comparison

As an advanced track-day driver,  
I want to compare two sessions from the same vehicle and track,  
So that I can understand what changed between runs.

Acceptance criteria:

- Given I am viewing a session detail page
- When I choose Compare
- Then I can select another session from the same vehicle
- And sessions from the same track/layout are visually prioritized
- And incompatible sessions are still selectable only with a clear warning

## Story 2: Understand Lap-Time Change

As a driver reviewing my session history,  
I want to see best lap, average lap, lap count, and consistency side by side,  
So that I can tell whether I was truly better or only had one good lap.

Acceptance criteria:

- Given both sessions have lap-time data
- When the comparison loads
- Then I see best lap delta, average lap delta, lap count, and consistency delta
- And deltas clearly show which session was faster or more consistent
- And missing lap data shows an empty state instead of fake values

## Story 3: Review Setup Differences

As a driver tuning my vehicle,  
I want to see only the setup fields that changed,  
So that I can focus on the adjustments most likely worth reviewing.

Acceptance criteria:

- Given two sessions have setup logs
- When the comparison loads
- Then changed fields are shown by default
- And unchanged fields can be expanded
- And each changed field shows baseline value and comparison value

## Story 4: Avoid Misreading Weak Comparisons

As a safety-conscious driver,  
I want the app to flag major context differences,  
So that I do not assume a setup change caused a lap-time change when other factors may explain it.

Acceptance criteria:

- Given sessions differ by track, vehicle, weather, track temperature, tire condition, or missing lap data
- When the comparison loads
- Then the app shows confidence/context warnings
- And the app avoids causal language
- And the summary uses language like "comparison signal," not "proof"

## Story 5: Save a Takeaway

As a driver improving over multiple sessions,  
I want to save a takeaway from a comparison,  
So that I can remember what to test next session.

Acceptance criteria:

- Given I have reviewed a comparison
- When I write and save a takeaway
- Then the takeaway is attached to the comparison or session
- And I can see it later from the session detail or history view
- And the takeaway can include a next-session focus

## Story 6: Support Future Coach/Shop Use

As a coach or shop manager,  
I want the comparison model to eventually support multiple drivers,  
So that I can help drivers learn from session data without rebuilding the feature later.

Acceptance criteria:

- Given v1 is individual-driver focused
- When the product is documented
- Then coach/shop comparison is marked as a future phase
- And privacy, permissions, and benchmark ownership are listed as unresolved requirements

## Story 7: Suggested Comparison After Logging

As a driver logging a new session,  
I want the app to suggest a relevant previous session to compare against,  
So that I can review the session while the details are still fresh.

Acceptance criteria:

- Given I save a session with a vehicle and track
- When a previous session exists for the same vehicle and track
- Then the app suggests a comparison
- And I can open it immediately or dismiss it
- And dismissed suggestions do not block the normal session detail flow

## Story 8: Manual Lap-Time Entry

As a budget-focused track-day user,  
I want to enter lap times manually,  
So that I can use comparison without buying telemetry hardware.

Acceptance criteria:

- Given I am editing or creating a session
- When I add lap times manually
- Then the app validates the format
- And invalid lap times show a clear error
- And valid lap times are available to comparison charts
