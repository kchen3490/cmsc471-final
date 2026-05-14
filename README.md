# CMSC471 Final Project: Visualizing Colonist.io Games
Andy Diep, Jeff Liu, Tony Zheng, Kai Chen

# Introduction
We created this project to visualize existing and manually generated games of Colonist.io.
Our webpage contains two sections for these two purposes (analytics and playground respectively).

The analytics tab displays the Colonist.io board for the associated game (chosen via a dropdown). All stored games met a set
of criteria to make analysis easier.
A heuristic function helps the players see the most optimal moves to make (that we have deemed).
The user may analyze any turn from the first one to the last one of the game, and the board updates to show the moves the player makes.
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
The group first started the development process by envisioning a game analysis of colonist.io, much like chess.com's analysis of their games.
Soon, the group started their research by playing a game in colonist.io to understand the game mechanics. Afterwards, the group found a dataset on a GitHub repository online (before it got taken down).
Andy Diep began recording insights for the data, and Kai Chen began contacting the founders of colonist.io (who eventually provided public assets and a license for the dataset) for assistance.
Afterwards, the group split off the tasks, where 1) Jeff Liu preprocessed the data; 2) Andy Diep gave some insights into the data json files; 3) Tony Zheng began strategic analysis of the game by developing
a heuristic function; and 4) Kai Chen developed a new playground tab for manual input of games.

Furthermore, Jeff Liu added a die rolling bar chart visualization, Andy Diep fixed some frontend bugs and spotted some bugs in the analytics and playground tab, and Kai Chen fixed those bugs.
In the end, the team met one last time to run a demo through the entire visualization and succeeded in creating a working application.

Some things we wish to change in the future is developing a better heuristic function. We did use machine learning to analyze all of the games, and we wish we did so that we could've made a better heuristic function.

# Contributions:
Andy Diep:
- Planned the distribution of tasks amongst the group
- Created and documented the skeleton code
- Reformatted the JSON Colonist game data files to be more readable
- Performed analysis of the JSON Colonist game data files to understand the enums and how information was stored
- Created a Catan board visualization to show hexes, ports, and hex/vertex/edge coordinates for debugging purposes
- Integrated public Colonist assets
- Devised idea for dedicated Analytics and Playground tabs
- Created turn slider, dice log, and player tracker to keep track of all in-game actions
- Ensured smooth game flow for both analytics and playground tabs
- Produced prompts for other group members to produce results for the playground tab

Jeff Liu:
- Data preprocessing
- Dynamic heuristic line graph vis
- Dynamic dice rolling bar chart vis
- Testing playground for bugs
- README

Tony Zheng:
- Founded the heuristic function's skeleton code

Kai Chen:
- Playground tab
- Modified heuristic function
- Fixed frontend issues
- Set up GitHub repository and webhook to update team members on commits and updates

Development was done with the support of AI (Cursor, Claude, Antigravity, Gemini)
