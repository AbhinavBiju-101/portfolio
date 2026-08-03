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


def compile_sources(javac_cmd, src_root, out_dir):
    java_files = find_java_files(src_root)
    if not java_files:
        raise RuntimeError("No .java files found in the source zip.")
    os.makedirs(out_dir, exist_ok=True)
    cmd = javac_cmd + ["-d", out_dir, "-cp", src_root, "-encoding", "UTF-8"] + java_files
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Compilation failed:\n{result.stderr}")
    return java_files


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

        print("Compiling...")
        java_files = compile_sources(javac_cmd, src_root, out_dir)
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

        jar_path = os.path.join(PORTFOLIO_ROOT, "static", "previews", args.slug, f"{args.slug}.jar")
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
