# Preview-only stand-in for the real colors.py.
#
# The real game (see the Download button) uses actual ANSI escape codes
# here for a colored terminal. This site's in-browser preview console is a
# plain <pre> tag with no ANSI-to-HTML rendering, so real escape codes
# would show up as literal garbage text like "\033[0;31m" instead of color.
# Every name below is kept identical to the real colors.py (so main.py's
# `from colors import *` needs zero changes) but mapped to an empty string.

Red = ""
Green = ""
Orange = ""
Blue = ""
Purple = ""
Cyan = ""
White = ""

bright_black = ""
bright_red = ""
bright_green = ""
bright_yellow = ""
bright_blue = ""
bright_magenta = ""
bright_cyan = ""
bright_white = ""

cyan_back = ""
purple_back = ""
white_back = ""
blue_back = ""
orange_back = ""
green_back = ""
pink_back = ""
grey_back = ""

bold = ""
underline = ""
italic = ""
darken = ""
invisible = ""
reverse = ""
reset = ""
