# CMSC471 Final Project: Visualizing Colonist.io Games
Andy Diep, Jeff Liu, Tony Zheng, Kai Chen

# Introduction
We created this project to visualize existing and manually generated games of Colonist.io.
Our webpage contains two sections for these two purposes (analytics and playground respectively).

The analytics tab displays the Colonist.io board for the associated game (chosen via a dropdown). All stored games met a set
of criteria to make analysis more easier. 
You may go from the first move to the last move of the game, and the board updates to show the move the player made.
Game events are displayed in the game log. Player profiles are dislayed underneath the game log, which contain resource counts,
road/settlement counts and the like.
After they roll their dice, a bar chart updates to depict the distribution in the game currently.

If a user want to run through one of their own games, they would click on the playground tab.
To start, they would need to specify the number of players, player colors, and turn order.
This tab contains a similar interface as the analytics tab. It has a dynamic bar chart for the current dice rolls, a game log, 
and player profiles with relevant information at the current point in the game.

The main difference is that now you can:
Label hexes type of tile (wood, brick, sheep, wheat, ore, desert)
Label hexes with a dice number (2 through 12)
Input individual turns (building, trading with player/bank, dice rolling, etc.)
Check the legality of move inputs
For example, the software does not allow the user to trade if at least 1 party has >=1 of the resource type.
For more information on Colonist.io rules, please consult https://colonist.io/

# Development Process


# Contributions:
Andy Diep:

Jeff Liu:
- Data preprocessing
- Dynamic heuristic line graph vis
- Dynamic dice rolling bar chart vis
- Testing playground for bugs
- README

Tony Zheng:

Kai Chen:
- Playground tab
- Modified heuristic function
- Fixed frontend issues

Development was done with the support of AI (Cursor, Claude, Antigravity, Gemini)
