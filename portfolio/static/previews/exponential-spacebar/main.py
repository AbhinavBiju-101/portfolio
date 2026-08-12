#-------------------------------------------------------------
# This is a browser-preview build, not the original source.
#
# The real game (see the Download button on this project's page) depends
# on two Replit-specific things that don't exist outside a Repl:
#   - `replit.db`, a hosted persistent key-value store, for accounts /
#     scores / the world record
#   - `sshkeyboard`, which hooks raw keyboard events for the spacebar/`x`
#     controls
#
# Neither works over a piped browser terminal (no real keyboard to hook,
# no REPLIT_DB_URL to talk to), so this build swaps in:
#   - a JSON-file-backed stand-in for replit.db (accounts.json, next to
#     this script), kept behind the same `db[key]`, `db[key].value`,
#     `.copy()` interface the real code uses, so the game logic below is
#     otherwise untouched. Accounts, personal bests, and the world record
#     persist across preview sessions the same way they would against the
#     real replit.db — this file is the actual save data, not a cache.
#   - reading a line from stdin each turn instead of a raw key hook —
#     press Enter (or type "space") for a point, type "x" to quit, matching
#     how every other console preview on this site takes input
#   - a real ANSI clear-screen, now that the site's console preview parses
#     one properly (see main.js) instead of this needing to fake it
#
# Everything else — the login/signup flow, the scoring, the big-number
# formatting, the boost/exp math — is the same as the real game. Passwords
# are hashed before hitting disk here (the real replit.db build stored them
# in plain text, which is fine for a private Repl but not for a file that
# world-visitors' preview sessions all read/write).
#-------------------------------------------------------------
#imports

import random
import time
import math
import os
import json
import hashlib
from colors import *

#-------------------------------------------------------------
# JSON-file-backed stand-in for replit.db — same interface the real code
# expects: db[key], db[key] = value, db[key].value, and dict-like values
# that support .copy(). Every read/write goes straight to accounts.json
# under a file lock (rather than caching in memory), since each preview
# session is its own OS process — one per visitor/tab — all sharing this
# one store, and the login/world-record feature only means something if
# concurrent sessions actually see each other's writes.

_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "accounts.json")
_LOCK_PATH = _STORE_PATH + ".lock"


def _with_lock(fn):
    """Run fn() while holding an exclusive lock on the store, so two
    preview sessions writing at once (e.g. both updating the world
    record) can't clobber each other. Best-effort on non-POSIX platforms
    where fcntl isn't available."""
    lock_fh = open(_LOCK_PATH, "a+")
    try:
        try:
            import fcntl
            fcntl.flock(lock_fh, fcntl.LOCK_EX)
        except ImportError:
            pass
        return fn()
    finally:
        try:
            import fcntl
            fcntl.flock(lock_fh, fcntl.LOCK_UN)
        except ImportError:
            pass
        lock_fh.close()


def _read_store():
    if not os.path.exists(_STORE_PATH):
        return {"World best": 0}
    try:
        with open(_STORE_PATH, "r") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"World best": 0}
    if "World best" not in data:
        data["World best"] = 0
    return data


def _write_store(data):
    # Write-to-temp-then-rename so a reader never sees a half-written file
    # (os.replace is atomic on POSIX, which is what this preview runs on).
    tmp_path = f"{_STORE_PATH}.tmp{os.getpid()}"
    with open(tmp_path, "w") as f:
        json.dump(data, f)
    os.replace(tmp_path, _STORE_PATH)


def _hash_password(password):
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


class _DBValue(dict):
    @property
    def value(self):
        return self


class _LocalDB(dict):
    def __getitem__(self, key):
        def _do():
            store = _read_store()
            if key not in store:
                raise KeyError(key)
            raw = store[key]
            return _DBValue(raw) if isinstance(raw, dict) else raw

        return _with_lock(_do)

    def __setitem__(self, key, value):
        def _do():
            store = _read_store()
            store[key] = dict(value) if isinstance(value, dict) else value
            _write_store(store)

        _with_lock(_do)

    def __contains__(self, key):
        return _with_lock(lambda: key in _read_store())

    def keys(self):
        return _with_lock(lambda: list(_read_store().keys()))

    def __iter__(self):
        return iter(self.keys())


db = _LocalDB()
# Only seed "World best" the very first time this ever runs — unlike the
# old in-memory version, we must NOT stomp it back to 0 on every session
# start now that it's meant to persist.
if "World best" not in db:
    db["World best"] = 0


def clear():
    """Stand-in for replit.clear(). The site's console preview now runs a
    small real terminal emulator (cursor moves, \\r overwrites, and
    clear-screen are all actually interpreted, not just dropped), so this
    can emit a genuine ANSI clear-screen + cursor-home instead of a plain
    divider — matching what a real terminal (and the actual downloadable
    game) does."""
    print("\x1b[2J\x1b[H", end="")


def get_key():
    """Stand-in for sshkeyboard's raw spacebar/x hook. Reads one line of
    stdin: Enter (or "space") scores a point, "x" (or "quit"/"exit") goes
    back to the menu. Anything else is treated as a press too, so mashing
    the input box still works."""
    try:
        line = input().strip().lower()
    except EOFError:
        return "x"
    if line in ("x", "quit", "exit"):
        return "x"
    return "space"


#-------------------------------------------------------------
#setup variables

logged = False


def verify_username(username):
  if len(username) < 2:
    raise Exception("Username must be longer than 2 characters!")
  if " " in username:
    raise Exception("Username must contain only letters, numbers, or symbols!")
  if len(username) > 15:
    raise Exception("Username must not be longer than 15 characters")
  try:
    if list(db.keys()).index(username) > -1:
      raise Exception("User already exists!")
  except ValueError:
    pass
  except Exception as e:
    raise e


def verify_password(password):
  if len(password) < 8:
    raise Exception("Password must be longer than 8 characters!")
  alphabet = "abcdefghijklmnopqrstuvwxyz"
  numbers = "1234567890"
  if not (any(word in ' '.join(list(password)) for word in set(alphabet))
          and any(word in ' '.join(list(password))
                  for word in set(alphabet.upper()))
          and any(word in ' '.join(list(password)) for word in set(numbers))):
    raise Exception(
      "Password must contain at least one small letter, one big letter and one number!"
    )


#-------------------------------------------------------------
#login/signup page

print(f"{bright_yellow}Preview build — press Enter for [spacebar], type 'x' + Enter for the [x] menu key.{reset}\n")

username = ""
while logged == False:
  print("Login or sign up?")
  LorS = ""
  try:
    LorS = input()
  except Exception as e:
    print(e)

  if LorS.lower() == "login":
    while True:
      print("\nusername:")
      username = input()
      try:
        try:
          if list(db.keys()).index(username) > -1:
            #print("\nfound user")
            password = ""
            while True:
              print("\npassword:")
              password = input() #use maskpass here
              print("")
              if db[username].value['password'] == _hash_password(password):
                print(f"{Green}login successful{reset}")
                logged = True
                break
              else:
                print(f"{Red}Incorrect password!{reset}")
            break
          else:
            raise Exception("User dosen't exist! Try again.")
        except ValueError:
          raise Exception("User dosen't exist! Try again.")
      except Exception as e:
        print("")
        print(f"{Red}{e}{reset}")

  elif LorS.lower() == "sign up":
    username = ""
    while True:
      print("\nusername?")
      username = input()
      try:
        verify_username(username)
        break
      except Exception as e:
        print("")
        print(f"{Red}{e}{reset}")
    password = ""
    while True:
      password2 = ""
      print("\npassword?")
      password = input()
      try:
        verify_password(password)
        print("re-enter password:")
        password2 = input()
        if password == password2:
          break
        else:
          raise Exception("passwords do not match! Try again")
      except Exception as e:
        print("")
        print(f"{Red}{e}{reset}")
    db[username] = {}
    data = {}
    data["password"] = _hash_password(password)
    data["highscore"] = 0
    data["experience"] = 0
    db[username] = data
    print(f"{Green}\nsigned up successfully.{reset}")
    logged = True
  print("----------------------------------------------")

#-------------------------------------------------------------
#loading screen

loading_stuff = [
  "Assets", "Inventory", "Data", "Loot", "Enemies", "Skills", "Settings",
  "Engine", "Text", "Stuff", "Profile", "account", "player", "Experience",
  "Levels", "Boosts", "Scores", "variables", "functions", "libraries",
  "classes", "Listeners", "Multipliers", "Files"
]
t_prog = random.randint(100, 1000)
c_prog = 0
progress = "(" + str(c_prog) + "/" + str(t_prog) + ")"

time.sleep(0.5)
print(f"{bright_yellow}Loading {reset}{Orange}-{reset}{bright_yellow} ... {progress}{reset}")
time.sleep(0.5)

clear()

c_prog += random.randint(0, 100)
progress = "(" + str(c_prog) + "/" + str(t_prog) + ")"

while c_prog < t_prog:
  current_stuff = loading_stuff[random.randint(0, len(loading_stuff) - 1)]
  for i in range(0, 4):
    print(f"{bright_yellow}Loading {reset}"+['- ', '\\ ', '| ', '/ '][i]+f"{Orange}{current_stuff}{reset}{bright_yellow} ... {progress}{reset}")
    time.sleep(0.5)
    clear()
    c_prog += random.randint(1, 100)
    if c_prog > t_prog:
      c_prog = t_prog
    progress = "(" + str(c_prog) + "/" + str(t_prog) + ")"

time.sleep(0.5)
print(f"{Green}Loading complete!{reset}")
time.sleep(0.5)
clear()

#-------------------------------------------------------------
#engine setup

score = 0
if random.randint(0, 00) == 0:
  score = db[username]['highscore']  #hax

Key = ""

Exp_Levels = [1]
for i in range(0, 501):
  Exp_Levels.append(round(Exp_Levels[i] * 1.1, 1))

#-----------------------------[
#number table

number_table = [
  "Thousand", "Million", "Billion", "Trillion", "Quadrillion", "Quintillion",
  "Sextillion", "Septillion", "Octillion", "Nonillion", "Decillion",
  "Undecillion", "Duodecillion", "Tredecillion", "Quattuordecillion",
  "Quinquadecillion", "Sexdecillion", "Septendecillion", "Octodecillion",
  "Novemdecillion", "Vigintillion"
]


def translate_exponent(number):
  if 'e' in str(number):
    base = 10**int(str(number).split('+')[1])
    Listed = list(str(base))
    Num = ''.join(n for n in list(str(number).split('e')[0]) if n != '.')
    c = 0
    for i in list(Num):
      Listed[c] = i
      c += 1
    return int(''.join(n for n in Listed))
  else:
    return number


def translate_number(num):
  number = translate_exponent(num)
  length = len(str(number))
  length_fmod = math.fmod(length, 3)
  if length_fmod == 0:
    length_fmod = 3
  exponent_number = 0
  exponent = ''
  if int((length - length_fmod) / 3) > 0:
    exponent_number = int((length - length_fmod) / 3)
    exponent = number_table[exponent_number - 1]
  integer = str(number)[0:int(length_fmod)]
  decimal = ''
  if exponent_number < 1:
    decimal = str(number)[int(length_fmod):]
  else:
    decimal = str(number)[int(length_fmod):int(length_fmod) + 3]
  decimal = round(float('0.' + decimal), 3)
  if decimal == 0.0:
    decimal = ''
  else:
    decimal = str(decimal)[2:]
  if decimal == '':
    if exponent == '':
      return str(integer)
    else:
      return str(integer) + ' ' + exponent
  else:
    if exponent == '':
      return str(integer) + '.' + str(decimal)
    else:
      return str(integer) + '.' + str(decimal) + ' ' + exponent


#------------------]

highscore = db[username].value["highscore"]

#-------------------------------------------------------------
#engine


while True:
  clear()

  increment = int(1 + ((score - math.fmod(score, 500)) / 500))

  print(f"{bold}Score:{reset} " + str(translate_number(score)))
  print(f"{bold}Boost:{reset} "+ "+" + str(translate_number(increment)))
  print(f"\n{bright_black}(press {reset}{Blue}[Enter]{reset}{bright_black} for points)")
  print(f"{bright_black}(every 500 score adds +1 boost){reset}")
  print(f"{bright_black}(type {reset}{Blue}x{reset}{bright_black} + Enter to go back to menu){reset}")

  if highscore < score:
    print(f"{Green}\nYou have improved your highscore to {reset}" +
          str(translate_number(score)))
    data = db[username].value.copy()
    data["highscore"] = score
    highscore = score
    db[username] = data
    if highscore>db["World best"]:
      db["World best"] = highscore
  else:
    print(f"\n{bold}Personal best:{reset} " +str(translate_number(highscore)))
  print(f"{bold}World record: {reset}"+str(translate_number(db["World best"])))

  data = db[username].value.copy()
  data["experience"] += 0.1
  lv = 0
  exp = round(data["experience"], 1)
  for i in Exp_Levels:
    if exp >= i:
      lv += 1

  print(f"\n{bold}Exp:{reset}{Purple} Level {str(lv)}{reset} (" + str(exp) + "/" +
        str(Exp_Levels[lv]) + ")")

  db[username] = data

  score += increment

  Key = get_key()
  if Key == "x":
    break

print(f"{Green}\nCongratulations! you have reached a score of {reset}{str(translate_number(score-1))}{Green}!{reset}")
