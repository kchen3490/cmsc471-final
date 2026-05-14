# Goal Description
Update the Catan Analytics tab to:
1. Show initial and new settlements/roads correctly by fixing how state changes are merged.
2. Correctly track the number of cities built per player using `mechanicCityState`.
3. Keep a log of all dice rolls by taking the sum of `firstDice` and `secondDice`.
4. Track all resources and development cards for each player during each turn.

## User Review Required
No major UI breaking changes, but adding resources and dev cards will expand the player card in the Analytics tab.

## Open Questions
- Dev card mapping assumption: Are dev cards mapped as 11=Knight, 12=VP, 13=RoadBuilding, 14=YearOfPlenty, 15=Monopoly? I will map them as best as possible, or display raw numbers if the names are not standard. Let me know if you have a specific enum mapping. I will assume 11=Knight, 12=Victory Point, 13=Road Building, 14=Year of Plenty, 15=Monopoly.
- Resource mapping assumption: I will use 1=Wood, 2=Brick, 3=Sheep, 4=Wheat, 5=Ore.

## Proposed Changes

### js/script.js

#### [MODIFY] js/script.js
- In `parseTurnsFromEvents`:
  - **Deep merge map state**: Update the loop merging `tileEdgeStates` and `tileCornerStates` so that instead of `Object.assign(currentTurn.roads, ...)`, it iterates over the keys and merges the properties into existing objects. This ensures `x`, `y`, `z` coordinates aren't deleted.
  - **Track dice rolls**: Look at `stateChange.gameLogState` for `type === 10` messages to extract `firstDice` and `secondDice`, and calculate the sum. Add it to `currentTurn.diceRolls`.
  - **Track Cities/Settlements/Roads explicitly**: Parse `mechanicCityState`, `mechanicSettlementState`, and `mechanicRoadState` to maintain the precise counts of built cities (`4 - bankCityAmount`), settlements (`5 - bankSettlementAmount`), and roads (`15 - bankRoadAmount`).
  - **Track Resources & Dev Cards**: In `stateChange.playerStates` and `stateChange.mechanicDevelopmentCardsState`, track the current arrays of cards for each player. Update `currentTurn.playerResources` and `currentTurn.playerDevCards`.
- In `updateAnalyticsPlayerTracker`:
  - Update the UI to display the calculated number of cities instead of just counting `buildingType === 2`.
  - Display the counts of each resource and dev card for each player.

## Verification Plan
- Load the game data in the UI.
- Move the Turn Slider to verify that initial placements (Turn 0 to Turn 8) appear on the board correctly.
- Check the dice log to see if rolls populate.
- Check the player cards in the sidebar to see accurate city counts, resource counts, and dev card counts.
