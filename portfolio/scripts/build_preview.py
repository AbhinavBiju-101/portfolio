#!/usr/bin/env python3
"""
build_preview.py — compile a Java project's source zip into a runnable
preview jar (for the "Preview" button's java-console runtime), and drop a
copy into static/downloads/ as a fallback Download link.

This is what makes updating a project as easy as swapping the zip: whenever
you want to update a project shown on the site, just re-export/re-zip your
BlueJ (or Eclipse/Maven) project and rerun this script — no manual jar
building, no touching app.py's file paths.

USAGE
-----
    python scripts/build_preview.py <slug> <path-to-source-zip> [options]

<slug> must match the project's "slug" field in app.py's PROJECTS list.

OPTIONS
-------
    --main-class NAME
        Explicit entry-point class (must have a real
        `public static void main(String[] args)`). Use this if
        auto-detection picks the wrong class (e.g. a project with several
        classes that each happen to have a main method).

    --entry-class NAME  --entry-method NAME
        For BlueJ-style projects whose "real" entry point is a **no-arg**
        method — e.g. `static void main()` meant to be invoked from BlueJ's
        object bench by right-clicking the class, which is NOT a valid JVM
        entry point on its own. This generates a tiny launcher class that
        calls that method via reflection, so `java -jar` works normally.
        --entry-method defaults to "main" if omitted.

    --no-download-zip
        Skip copying the source zip into static/downloads/<slug>.zip.
        Use this if the project already has a "github" link set in app.py
        (the Download button uses that instead and ignores this file).

EXAMPLES
--------
    # Normal console app with a standard main(String[] args)
    python scripts/build_preview.py mining-simulator sources/mining-simulator.zip

    # BlueJ project whose real entry point is Greed_Island.main() (no args)
    python scripts/build_preview.py greed-island sources/greed-island.zip \\
        --entry-class Greed_Island --entry-method main

REQUIREMENTS
------------
Needs a JDK (not just a JRE) on PATH — i.e. `javac` must work. If you can
run `java -jar your-project.jar` you probably still need the JDK
specifically for *this* script, since it compiles source. Get one from
https://adoptium.net if `javac -version` fails in your terminal.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

PORTFOLIO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def find_javac_command():
    """Prefer a real javac binary; fall back to invoking the compiler module
    directly through `java`, since some JRE-labeled installs (e.g. Ubuntu's
    openjdk-*-jre-headless, which is what this script was first built and
    tested against) still bundle jdk.compiler without exposing the javac
    launcher script itself."""
    if shutil.which("javac"):
        return ["javac"]
    if shutil.which("java"):
        probe = subprocess.run(
            ["java", "-cp", ".", "com.sun.tools.javac.Main", "-version"],
            capture_output=True, text=True,
        )
        if "javac" in (probe.stdout + probe.stderr).lower():
            return ["java", "com.sun.tools.javac.Main"]
    return None


def find_java_files(root):
    files = []
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            if fn.endswith(".java"):
                files.append(os.path.join(dirpath, fn))
    return files


def find_public_main_class(java_files):
    """Scan source for a class with a real public static void main(String[]),
    returning its (unqualified) class name, or None if none found."""
    main_pattern = re.compile(r"public\s+static\s+void\s+main\s*\(\s*String")
    class_pattern = re.compile(r"(?:public\s+)?(?:final\s+)?class\s+(\w+)")
    for path in java_files:
        with open(path, "r", errors="replace") as f:
            content = f.read()
        if main_pattern.search(content):
            m = class_pattern.search(content)
            if m:
                return m.group(1)
    return None


def compile_sources(javac_cmd, src_root, out_dir, release=None):
    """`release`, if given, is passed as `--release N` to javac, pinning the
    output .class file bytecode version instead of defaulting to whatever
    the local JDK happens to be. This matters specifically for CheerpJ-based
    previews: CheerpJ 4.3 only loads class files up to Java 17 (major
    version 61) — if this build machine has a newer JDK on PATH (21, 25,
    whatever), classes compile fine locally with `java -jar` but CheerpJ
    then refuses to load them in-browser with a "Required Java version NN,
    but CheerpJ only supports up to Java 17" error. --release also makes
    javac validate against that version's actual API (not just tag the
    class file number), so this catches real incompatibilities too, not
    just the version tag.
    """
    java_files = find_java_files(src_root)
    if not java_files:
        raise RuntimeError("No .java files found in the source zip.")
    os.makedirs(out_dir, exist_ok=True)
    cmd = javac_cmd + ["-d", out_dir, "-cp", src_root, "-encoding", "UTF-8"]
    if release:
        cmd += ["--release", str(release)]
    cmd += java_files
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Compilation failed:\n{result.stderr}")
    return java_files


# Matches `new ServerSocket(<one arg, no commas/parens>)` — deliberately does
# NOT match the 2- or 3-arg overloads (those already specify a backlog and/or
# bind address explicitly, so leave them alone rather than risk mangling
# something already intentional).
_SERVER_SOCKET_PATTERN = re.compile(r"new\s+ServerSocket\s*\(\s*([^,()]+?)\s*\)")


def patch_loopback_only(java_files):
    """Rewrite every single-arg `new ServerSocket(PORT)` call to bind to a
    *runtime-configurable* address (JVM system property `preview.bindAddr`,
    defaulting to 127.0.0.1) instead of all interfaces (the JVM default for
    that constructor).

    This is deliberately a runtime property rather than a literal baked in
    at compile time: it means the exact same jar can be launched two
    different ways —
      java -jar chatroom-server.jar
          -> binds 127.0.0.1 (default), used for the internal Python-driven
             preview demo. Unreachable from outside the container no matter
             how the host platform's public port routing is configured.
      java -Dpreview.bindAddr=<tailscale-ip> -jar chatroom-server.jar
          -> binds only that address, used for a second, independent server
             instance that's reachable exclusively over the Tailscale
             network a CheerpJ-hosted real GUI client joins — see
             /preview/chatroom-network/gui-config in app.py.
    Neither launch mode ever binds 0.0.0.0, so this never re-opens the
    public-internet exposure that caused the original bug.

    Real socket-based multiplayer/LAN behavior between actual separate
    machines on someone's own network is exactly what a hardcoded loopback
    bind would break, so this is opt-in (--loopback-only) and meant for
    preview builds specifically, not the real downloadable source.
    Returns the number of call sites patched, across all files, for the
    caller to report (and warn on, if zero — that likely means the source
    doesn't construct its socket the way this was written to expect)."""
    total = 0
    for path in java_files:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        def _replace(m):
            nonlocal total
            total += 1
            port_expr = m.group(1)
            return (f'new ServerSocket({port_expr}, 50, '
                    f'java.net.InetAddress.getByName('
                    f'System.getProperty("preview.bindAddr", "127.0.0.1")))')

        patched = _SERVER_SOCKET_PATTERN.sub(_replace, content)
        if patched != content:
            with open(path, "w", encoding="utf-8") as f:
                f.write(patched)
    return total


# Slug-specific source patches that are too particular to be a generic CLI
# flag (a single, targeted find/replace on one file, with a comment
# explaining exactly why). Applied automatically for a matching slug,
# always on top of --loopback-only if that's also passed. Keep this list
# short and each entry well-documented — it's the audit trail for exactly
# how a preview build's behavior diverges from the real distributed source.
PREVIEW_SOURCE_PATCHES = {
    "chatroom": [
        (
            "ChatClient.java",
            # Real ChatClient always auto-detects the local LAN IP via
            # `ifconfig` (getIP()) and unconditionally tries to create a
            # desktop shortcut — neither makes sense for a copy running
            # inside a browser via CheerpJ. Preview build instead takes the
            # target host as argv[0] (cheerpjRunMain's args param), falling
            # back to the original auto-detect + shortcut behavior if no
            # arg is given, so this patch is a strict superset, not a
            # removal, of the original behavior.
            'createShortcut("Chatrooms", "ChatClient", "icon.png");\n'
            '        SERVER_IP = getIP();',
            'if (args != null && args.length > 0 && args[0] != null && !args[0].isEmpty()) {\n'
            '            SERVER_IP = args[0];\n'
            '        } else {\n'
            '            createShortcut("Chatrooms", "ChatClient", "icon.png");\n'
            '            SERVER_IP = getIP();\n'
            '        }',
        ),
    ],
}


def apply_source_patches(slug, java_files):
    patches = PREVIEW_SOURCE_PATCHES.get(slug)
    if not patches:
        return 0
    by_name = {os.path.basename(p): p for p in java_files}
    applied = 0
    for filename, old, new in patches:
        path = by_name.get(filename)
        if path is None:
            print(f"WARNING: source patch for {slug} targets {filename}, "
                  f"but that file wasn't found in the source zip.", file=sys.stderr)
            continue
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        if old not in content:
            print(f"WARNING: source patch for {slug}/{filename} didn't match "
                  f"anything — the source may have changed since this patch "
                  f"was written. Skipping that patch.", file=sys.stderr)
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(content.replace(old, new, 1))
        applied += 1
    return applied


LAUNCHER_TEMPLATE = """\
public class {launcher_name} {{
    public static void main(String[] args) throws Exception {{
        Class<?> target = Class.forName("{entry_class}");
        java.lang.reflect.Method m = target.getDeclaredMethod("{entry_method}");
        m.setAccessible(true);
        m.invoke(null);
    }}
}}
"""


def generate_launcher(javac_cmd, out_dir, entry_class, entry_method):
    launcher_name = "PreviewLauncher"
    src = LAUNCHER_TEMPLATE.format(
        launcher_name=launcher_name, entry_class=entry_class, entry_method=entry_method
    )
    launcher_path = os.path.join(out_dir, f"{launcher_name}.java")
    with open(launcher_path, "w") as f:
        f.write(src)
    cmd = javac_cmd + ["-d", out_dir, "-cp", out_dir, launcher_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Launcher compilation failed:\n{result.stderr}")
    os.remove(launcher_path)
    return launcher_name


def build_jar(class_dir, main_class, jar_path):
    os.makedirs(os.path.dirname(jar_path), exist_ok=True)
    manifest = f"Manifest-Version: 1.0\nMain-Class: {main_class}\n\n"
    with zipfile.ZipFile(jar_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("META-INF/MANIFEST.MF", manifest)
        for dirpath, _, filenames in os.walk(class_dir):
            for fn in filenames:
                if fn.endswith(".class"):
                    full = os.path.join(dirpath, fn)
                    arcname = os.path.relpath(full, class_dir)
                    zf.write(full, arcname)


def sanity_check(jar_path):
    """Quick smoke test: launch the jar with empty stdin. A console app will
    likely print its menu, then throw once it tries to read from the
    already-EOF'd stdin — that's expected and fine, it proves the jar itself
    is structurally sound. What we're actually watching for is a *packaging*
    failure (wrong/missing Main-Class), which fails near-instantly with a
    distinct JVM launcher error rather than the app's own exception."""
    try:
        result = subprocess.run(
            ["java", "-jar", jar_path], input="", capture_output=True, text=True, timeout=4,
        )
        stderr = result.stderr or ""
        if "Error: Could not find or load main class" in stderr or "NoClassDefFoundError" in stderr:
            print(f"WARNING: jar packaging problem:\n{stderr[:500]}", file=sys.stderr)
            return False
        return True
    except subprocess.TimeoutExpired:
        # Still running after 4s with no input given — for an interactive
        # console app, that means it launched fine and is waiting on stdin.
        return True


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("slug", help="Project slug, matches app.py's PROJECTS list")
    parser.add_argument("source_zip", help="Path to a zip of the project's Java source")
    parser.add_argument("--main-class")
    parser.add_argument("--entry-class")
    parser.add_argument("--entry-method", default="main")
    parser.add_argument(
        "--jar-name",
        help="Output filename (default: <slug>.jar). Use this when the "
             "preview jar's name in app.py doesn't match the slug — e.g. "
             "chatroom's preview_server_entry is 'chatroom-server.jar', not "
             "'chatroom.jar'.",
    )
    parser.add_argument(
        "--release",
        type=int,
        default=17,
        help="Bytecode/API level to compile against, passed to `javac "
             "--release`. Defaults to 17, the newest version CheerpJ 4.3 "
             "can load in-browser — leave this alone for any project using "
             "the 'cheerpj' or 'network-sim' (real GUI) runtime. Pass a "
             "higher number (or --release 0 to skip the flag entirely and "
             "use the local JDK's default) only for java-console previews "
             "that never run through CheerpJ, if you specifically need "
             "newer language features.",
    )
    parser.add_argument(
        "--loopback-only",
        action="store_true",
        help="Rewrite single-arg `new ServerSocket(PORT)` calls to bind "
             "127.0.0.1 only, so the preview's real server process can't be "
             "reached from outside this machine no matter how the hosting "
             "platform's public port routing is set up. Only use this for "
             "preview builds — it does NOT touch static/downloads/*.zip, so "
             "anyone who downloads the real source still gets a socket that "
             "binds all interfaces, which real LAN/multi-machine use needs.",
    )
    parser.add_argument("--no-download-zip", action="store_true")
    args = parser.parse_args()

    javac_cmd = find_javac_command()
    if javac_cmd is None:
        print(
            "ERROR: no Java compiler found. Install a JDK (e.g. from "
            "https://adoptium.net) and make sure `javac -version` works "
            "in a terminal, then try again.",
            file=sys.stderr,
        )
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmp:
        src_root = os.path.join(tmp, "src")
        out_dir = os.path.join(tmp, "classes")
        os.makedirs(src_root, exist_ok=True)

        print(f"Extracting {args.source_zip} ...")
        with zipfile.ZipFile(args.source_zip) as zf:
            zf.extractall(src_root)

        java_files = find_java_files(src_root)
        patched_sites = apply_source_patches(args.slug, java_files)
        if patched_sites:
            print(f"Applied {patched_sites} slug-specific source patch(es) for '{args.slug}'.")
        if args.loopback_only:
            patched_count = patch_loopback_only(java_files)
            if patched_count == 0:
                print(
                    "WARNING: --loopback-only was set but no single-arg "
                    "`new ServerSocket(PORT)` call was found to patch — the "
                    "source may already bind explicitly, or construct its "
                    "socket a different way. Double check before assuming "
                    "this build is actually loopback-only.",
                    file=sys.stderr,
                )
            else:
                print(f"Patched {patched_count} ServerSocket call site(s) to bind 127.0.0.1 only.")

        print("Compiling..." + (f" (targeting Java {args.release})" if args.release else ""))
        java_files = compile_sources(javac_cmd, src_root, out_dir, release=args.release or None)
        print(f"  compiled {len(java_files)} source file(s)")

        if args.main_class:
            main_class = args.main_class
        elif args.entry_class:
            print(f"Generating launcher for {args.entry_class}.{args.entry_method}()...")
            main_class = generate_launcher(javac_cmd, out_dir, args.entry_class, args.entry_method)
        else:
            print("Auto-detecting entry point...")
            main_class = find_public_main_class(java_files)
            if not main_class:
                print(
                    "ERROR: no class with 'public static void main(String[] args)' "
                    "found.\nIf the real entry point is a no-arg method (common in "
                    "BlueJ projects — e.g. 'static void main()' meant to be run from "
                    "the object bench), rerun with:\n"
                    "  --entry-class <ClassName> --entry-method <methodName>",
                    file=sys.stderr,
                )
                sys.exit(1)
            print(f"  using {main_class}")

        jar_filename = args.jar_name or f"{args.slug}.jar"
        jar_path = os.path.join(PORTFOLIO_ROOT, "static", "previews", args.slug, jar_filename)
        build_jar(out_dir, main_class, jar_path)
        print(f"Wrote {jar_path}")

        if sanity_check(jar_path):
            print("Sanity check passed (jar launches without a packaging error).")

        if not args.no_download_zip:
            download_path = os.path.join(PORTFOLIO_ROOT, "static", "downloads", f"{args.slug}.zip")
            os.makedirs(os.path.dirname(download_path), exist_ok=True)
            shutil.copy(args.source_zip, download_path)
            print(f"Wrote {download_path}")

    print("Done.")


if __name__ == "__main__":
    main()