# DB Refactor Rules (DO NOT BREAK)

## FORBIDDEN

* Do NOT rename functions
* Do NOT change logic
* Do NOT change string values
* Do NOT remove `await`
* Do NOT add `await`
* Do NOT store `state.supabase` in a variable
* Do NOT run any code outside functions

## REQUIRED

* Always use `state.` before shared variables
* Keep code EXACTLY the same

## STOP IF:

* You are unsure where a function belongs
* Something looks unclear
* You feel like “fixing” code

## AFTER EACH STEP:

* App must still run
* No errors allowed
