#!/usr/bin/env python3
"""
analyze.py — One-off analysis of the 40k preprocessed Catan games.

Computes P(win | feature) for a dozen interesting features. Output is plain
text; pipe to a file if you want to keep it.

Schema notes (deduced from data/valid/*.json):
  data.eventHistory.endGameState.players[pid] = {
    rank, color, winningPlayer (bool),
    victoryPoints: {
      "0": settlement count   (1 VP each),
      "1": city count         (2 VP each),
      "2": longestRoad bonus  (0 or 1; awards 2 VP),
      "3": largestArmy bonus  (0 or 1; awards 2 VP),
      "4": VP dev cards       (1 VP each)
    }
  }
  data.eventHistory.events[i].stateChange.gameLogState[k].text = {
    type: int, playerColor: int, cardEnum: int, achievementEnum: int, ...
  }

Log types we care about:
   10 = dice roll
   20 = dev card played  (cardEnum 11=Knight, 14=RoadBuilding, etc.)
   66 = achievement gained  (achievementEnum 0=LongestRoad, 1=LargestArmy)
   68 = achievement transferred
  115 = player-to-player trade completed
  116 = bank trade completed
"""

import json
import glob
import os
import sys
from collections import Counter, defaultdict

VALID_DIR = os.path.join(os.path.dirname(__file__), "valid")

CARD_KNIGHT = 11

def iter_games(limit=None):
    files = sorted(glob.glob(os.path.join(VALID_DIR, "*.json")))
    if limit is not None:
        files = files[:limit]
    for i, f in enumerate(files):
        try:
            with open(f) as fh:
                yield json.load(f) if False else json.load(open(f))
        except Exception as e:
            print(f"  skip {f}: {e}", file=sys.stderr)
            continue
        if (i + 1) % 2000 == 0:
            print(f"  processed {i+1} games...", file=sys.stderr)


def player_features(game):
    """For a single game, return list of dicts (one per player) with features
       and a 'won' label."""
    data = game.get("data", {})
    ev = data.get("eventHistory", {})
    egs = ev.get("endGameState", {})
    players = egs.get("players", {}) or {}
    events = ev.get("events", []) or []

    # Per-player counters from event log
    knights_played = Counter()        # by playerColor
    longest_road_holder = Counter()   # tally of achievement-gained events
    largest_army_holder = Counter()
    trades_completed = Counter()       # player <-> bank or partner
    first_dice_turn = {}              # turn idx of first dice roll (proxy for "got to play")
    total_dice = 0

    for idx, e in enumerate(events):
        gls = e.get("stateChange", {}).get("gameLogState") or {}
        for msg in gls.values():
            txt = msg.get("text") or {}
            t = txt.get("type")
            pc = txt.get("playerColor")
            if t == 20:  # dev card played
                if txt.get("cardEnum") == CARD_KNIGHT and pc is not None:
                    knights_played[pc] += 1
            elif t == 66:  # achievement gained (initial award)
                ae = txt.get("achievementEnum")
                if ae == 0 and pc is not None:
                    longest_road_holder[pc] += 1
                elif ae == 1 and pc is not None:
                    largest_army_holder[pc] += 1
            elif t == 68:  # achievement transferred
                ae = txt.get("achievementEnum")
                new_pc = txt.get("playerColorNew")
                old_pc = txt.get("playerColorOld")
                if ae == 0:
                    if new_pc is not None:
                        longest_road_holder[new_pc] += 1
                    if old_pc is not None:
                        longest_road_holder[old_pc] -= 1
                elif ae == 1:
                    if new_pc is not None:
                        largest_army_holder[new_pc] += 1
                    if old_pc is not None:
                        largest_army_holder[old_pc] -= 1
            elif t in (115, 116):  # trades
                if pc is not None:
                    trades_completed[pc] += 1
            elif t == 10:  # dice roll
                total_dice += 1

    out = []
    for pid, p in players.items():
        vp_sources = p.get("victoryPoints") or {}
        # Standard mapping: 0=settlements, 1=cities, 2=longestRoad, 3=largestArmy, 4=VPcards
        n_settlements = int(vp_sources.get("0", 0))
        n_cities = int(vp_sources.get("1", 0))
        has_longest_road = bool(vp_sources.get("2", 0))
        has_largest_army = bool(vp_sources.get("3", 0))
        n_vp_cards = int(vp_sources.get("4", 0))
        total_vp = n_settlements * 1 + n_cities * 2 + (2 if has_longest_road else 0) + (2 if has_largest_army else 0) + n_vp_cards

        color = p.get("color")
        knights = knights_played.get(color, 0)
        n_trades = trades_completed.get(color, 0)

        out.append({
            "pid": pid,
            "color": color,
            "rank": int(p.get("rank", 0)),
            "won": bool(p.get("winningPlayer")),
            "vp_total": total_vp,
            "n_settlements": n_settlements,
            "n_cities": n_cities,
            "n_vp_cards": n_vp_cards,
            "has_longest_road": has_longest_road,
            "has_largest_army": has_largest_army,
            "knights_played": knights,
            "n_trades": n_trades,
            "n_dice_rolls": total_dice,
        })
    return out


def cwr(rows, predicate):
    """Conditional win rate over rows where predicate(row) is True. Returns
       (n_matching, n_won, rate). Useful one-liner for the table below."""
    n = 0; w = 0
    for r in rows:
        if predicate(r):
            n += 1
            if r["won"]:
                w += 1
    return n, w, (w / n if n else 0.0)


def bucketed_winrate(rows, key_fn, label="key"):
    """Print P(win | key=k) for each bucket k of key_fn(row)."""
    by = defaultdict(lambda: [0, 0])
    for r in rows:
        k = key_fn(r)
        by[k][0] += 1
        if r["won"]:
            by[k][1] += 1
    print(f"\n  {label:24s}  n      wins   P(win)")
    print(f"  {'':24s}  -----  -----  ------")
    for k in sorted(by):
        n, w = by[k]
        rate = (w / n) if n else 0.0
        print(f"  {str(k):24s}  {n:5d}  {w:5d}  {rate:6.3f}")


def main(limit=None):
    print(f"Reading games from {VALID_DIR} ...", file=sys.stderr)
    all_rows = []
    n_games = 0
    for g in iter_games(limit=limit):
        rs = player_features(g)
        if not rs:
            continue
        all_rows.extend(rs)
        n_games += 1
    n_players = len(all_rows)
    n_wins = sum(1 for r in all_rows if r["won"])
    base_rate = n_wins / n_players if n_players else 0
    print(f"\nGames analyzed: {n_games}")
    print(f"Player-rows:    {n_players}")
    print(f"Base win rate:  {base_rate:.3f}   (≈ 1 / avg_players_per_game)")

    # ── Achievement impact ────────────────────────────────────────────────
    print("\n=== Achievement impact ===")
    for flag, label in [("has_longest_road", "Longest Road"),
                        ("has_largest_army", "Largest Army")]:
        n_yes, w_yes, r_yes = cwr(all_rows, lambda r, f=flag: r[f])
        n_no,  w_no,  r_no  = cwr(all_rows, lambda r, f=flag: not r[f])
        print(f"  {label:18s}  P(win | holds)={r_yes:.3f} ({w_yes}/{n_yes})   "
              f"P(win | not)={r_no:.3f} ({w_no}/{n_no})   "
              f"lift={r_yes - r_no:+.3f}")

    # Both
    n_both, w_both, r_both = cwr(all_rows, lambda r: r["has_longest_road"] and r["has_largest_army"])
    n_neither, w_neither, r_neither = cwr(all_rows, lambda r: not r["has_longest_road"] and not r["has_largest_army"])
    print(f"  {'Both achievements':18s}  P(win)={r_both:.3f}  ({w_both}/{n_both})")
    print(f"  {'Neither':18s}  P(win)={r_neither:.3f}  ({w_neither}/{n_neither})")

    # ── Knight diminishing returns ─────────────────────────────────────────
    print("\n=== Knights played → P(win) ===")
    bucketed_winrate(all_rows, lambda r: min(r["knights_played"], 10), "knights_played (capped 10)")

    # ── City count ─────────────────────────────────────────────────────────
    print("\n=== Cities built → P(win) ===")
    bucketed_winrate(all_rows, lambda r: min(r["n_cities"], 5), "n_cities (capped 5)")

    # ── Settlements ────────────────────────────────────────────────────────
    print("\n=== Settlements remaining (on board) → P(win) ===")
    bucketed_winrate(all_rows, lambda r: min(r["n_settlements"], 5), "n_settlements (capped 5)")

    # ── VP-card holders ────────────────────────────────────────────────────
    print("\n=== VP development cards → P(win) ===")
    bucketed_winrate(all_rows, lambda r: min(r["n_vp_cards"], 4), "n_vp_cards (capped 4)")

    # ── Trades completed ───────────────────────────────────────────────────
    print("\n=== Trade activity → P(win) ===")
    def trade_bucket(r):
        n = r["n_trades"]
        if n == 0: return "0"
        if n <= 2: return "1-2"
        if n <= 5: return "3-5"
        if n <= 10: return "6-10"
        return "11+"
    bucketed_winrate(all_rows, trade_bucket, "trades_completed")

    # ── Knight cutoff: does the 3-knights cliff exist? ────────────────────
    print("\n=== Knight cutoff (P(win | k >= K)) ===")
    print(f"  {'K':5s}  {'n>=K':>7s}  {'wins>=K':>8s}  {'P(win|>=K)':>11s}  {'P(win|<K)':>11s}")
    for K in range(0, 8):
        n_ge, w_ge, r_ge = cwr(all_rows, lambda r, K=K: r["knights_played"] >= K)
        n_lt, w_lt, r_lt = cwr(all_rows, lambda r, K=K: r["knights_played"] < K)
        print(f"  {K:<5d}  {n_ge:>7d}  {w_ge:>8d}  {r_ge:>11.3f}  {r_lt:>11.3f}")

    # ── Best build mix ─────────────────────────────────────────────────────
    print("\n=== Mix of settlement vs city counts among winners ===")
    win_mix = Counter()
    all_mix = Counter()
    for r in all_rows:
        key = (min(r["n_settlements"], 5), min(r["n_cities"], 5))
        all_mix[key] += 1
        if r["won"]:
            win_mix[key] += 1
    print("  (settlements, cities) → n_winners (P(win | that mix))")
    rows = []
    for k in all_mix:
        n = all_mix[k]
        w = win_mix.get(k, 0)
        if n < 50: continue  # ignore very rare mixes
        rows.append((w / n, w, n, k))
    rows.sort(reverse=True)
    for rate, w, n, k in rows[:12]:
        print(f"   s={k[0]} c={k[1]}   wins={w:5d} / n={n:6d}   P(win)={rate:.3f}")

    # ── Suggested weight-tuning summary ─────────────────────────────────────
    print("\n=== Suggested weight-tuning takeaways ===")
    # Pull the key lifts
    _, _, lr_yes = cwr(all_rows, lambda r: r["has_longest_road"])
    _, _, lr_no  = cwr(all_rows, lambda r: not r["has_longest_road"])
    _, _, la_yes = cwr(all_rows, lambda r: r["has_largest_army"])
    _, _, la_no  = cwr(all_rows, lambda r: not r["has_largest_army"])
    print(f"  Longest Road lift: {lr_yes - lr_no:+.3f}   (rel weight ≈ {(lr_yes - lr_no) / max(la_yes - la_no, 1e-6):.2f}× of Largest Army)")
    print(f"  Largest Army lift: {la_yes - la_no:+.3f}")
    # Knight diminishing returns
    _, _, r3 = cwr(all_rows, lambda r: r["knights_played"] >= 3)
    _, _, r4 = cwr(all_rows, lambda r: r["knights_played"] >= 4)
    _, _, r5 = cwr(all_rows, lambda r: r["knights_played"] >= 5)
    print(f"  P(win | knights>=3): {r3:.3f}   P(win | knights>=4): {r4:.3f}   P(win | knights>=5): {r5:.3f}")
    print(f"  If r3 ≈ r4 ≈ r5, marginal knights past 3 add little win-prob; capping")
    print(f"  the army term at K=3 (clip K² at 9) may match the data better than unbounded K².")


if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    main(limit=limit)
