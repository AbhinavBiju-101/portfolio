# Portfolio (Flask MPA)

## Local setup

```bash
# 1. Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run the dev server
flask --app app run --debug --no-reload
```

Then open http://127.0.0.1:5000 in your browser.

`--no-reload` matters if you're using the "Preview" feature on a Java
project: the reloader restarts the server on every file save, which kills
any Java process running inside an open preview. Drop `--no-reload` if
you're just iterating on templates/CSS and not testing previews.

## Structure

```
portfolio/
├── app.py                  # routes + project data
├── requirements.txt
├── templates/
│   ├── base.html           # shared nav/footer, every page extends this
│   ├── index.html          # home page
│   ├── projects.html       # project grid, loops over PROJECTS
│   ├── project_detail.html # one page per project (future descriptions/media go here)
│   ├── about.html
│   └── 404.html
└── static/
    ├── css/style.css
    ├── js/main.js
    ├── images/             # drop project screenshots here
    └── downloads/          # drop the actual downloadable files here
        ├── project-one.zip (placeholder — replace)
        └── project-two.zip (placeholder — replace)
```

## Adding a project

1. Drop the downloadable file in `static/downloads/`.
2. (Optional) Drop a screenshot in `static/images/`.
3. Add an entry to the `PROJECTS` list at the top of `app.py`:

```python
{
    "slug": "my-new-project",
    "name": "My New Project",
    "tagline": "One-line summary.",
    "description": "Longer description.",
    "download_file": "my-new-project.zip",
    "image": "my-new-project.png",  # or None
},
```

That's it — the projects page and its detail page are generated automatically.
