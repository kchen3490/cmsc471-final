import os, json
# import shutil

# constants
DIRECTORY = "./data/games/"
PREPROCESSED_DIRECTORY = "./"

# condition checks
def c1(json):
    tile_hex_states = json['data']['eventHistory']["initialState"]["mapState"]["tileHexStates"]
    return len(tile_hex_states) == 19

def c2(json):
    return json['data']['gameSettings']['victoryPointsToWin'] == 10

def c3(json):
    return json['data']['gameSettings']['cardDiscardLimit'] == 7

def c4(json):
    map_settings = json['data']['gameSettings']['mapSetting'] == 0
    mode_settings = json['data']['gameSettings']['modeSetting'] == 0
    return map_settings and mode_settings

def c5(json):
    players = json['data']['playerUserStates']
    
    count = 0
    player_count = len(players)
    while count < player_count:
        # stop checking when a bot is detected
        if players[count]['isBot']:
            break
        count += 1
    # true if none of the players are bots and no. of players == 4
    # false otherwise
    return count == player_count and player_count == 4

# data loading
colonist_data = os.listdir(DIRECTORY)
process_id = 1

# comment this out when ready [HERE] start
valid = 0
invalid = 0
# end

for data in colonist_data:
    with open(DIRECTORY + data, 'r') as cg:
        cd = json.load(cg)

    if c1(cd) and c2(cd) and c3(cd) and c4(cd) and c5(cd):
        # comment this increment statement when ready [HERE]
        valid += 1
        #shutil.copy(DIRECTORY + data, PREPROCESSED_DIRECTORY + "valid")
    else:
        # comment this increment statement when ready [HERE]
        invalid += 1
        #shutil.copy(DIRECTORY + data, PREPROCESSED_DIRECTORY + "invalid")
    
    print(f"{process_id} - {data} processed")
    process_id += 1

print(f"{valid} entries detected")
print(f"{invalid} entries detected")