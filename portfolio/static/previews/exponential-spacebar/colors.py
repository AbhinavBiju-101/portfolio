# Preview-only stand-in for the real colors.py.
#
# Same names as the real game's colors.py (so main.py's `from colors import *`
# needs zero changes), now mapped to real ANSI escape codes instead of empty
# strings — the in-browser preview console parses ANSI color codes into
# actual color now (see ansiToHtml() in main.js), so there's no more need to
# strip them out here.

Red = "\033[31m"
Green = "\033[32m"
Orange = "\033[38;5;208m"
Blue = "\033[34m"
Purple = "\033[35m"
Cyan = "\033[36m"
White = "\033[37m"

bright_black = "\033[90m"
bright_red = "\033[91m"
bright_green = "\033[92m"
bright_yellow = "\033[93m"
bright_blue = "\033[94m"
bright_magenta = "\033[95m"
bright_cyan = "\033[96m"
bright_white = "\033[97m"

cyan_back = "\033[46m"
purple_back = "\033[45m"
white_back = "\033[47m"
blue_back = "\033[44m"
orange_back = "\033[48;5;208m"
green_back = "\033[42m"
pink_back = "\033[48;5;213m"
grey_back = "\033[100m"

bold = "\033[1m"
underline = "\033[4m"
italic = "\033[3m"
darken = "\033[2m"
invisible = "\033[8m"
reverse = "\033[7m"
reset = "\033[0m"
