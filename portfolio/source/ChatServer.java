import java.io.*;
import java.net.*;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class ChatServer {
    private static final int UPDATE_PORT = 34567; // new port for auto-updates
    private static final String UPDATE_FILE = "ChatClient.class"; // file to send for updates
    
    private static final int PORT = 12345;

    private static final Set<ClientHandler> clients =
            Collections.synchronizedSet(new HashSet<>());

    private static final List<String> messageHistory =
            Collections.synchronizedList(new LinkedList<>());

    private static final int MAX_HISTORY = 50;
    private static final SimpleDateFormat timeFormat = new SimpleDateFormat("HH:mm");
    private static ServerSocket serverSocket;
    private static final File filesDir = new File("server_files");

    // simple in-memory file index for quick existence checks
    private static final Map<String, File> fileIndex = new ConcurrentHashMap<>();

    // Server console commands help text
    private static final String SERVER_HELP =
        "\n📖 Server Commands:\n" +
        "  /help              - Show this help message\n" +
        "  /stop              - Stop the server\n" +
        "  /kick <username>   - Kick a specific user\n" +
        "  <message>          - Broadcast a server announcement (markup supported)\n";

    private static final Map<String, String> EMOJI_MAP = new LinkedHashMap<>();
    static {
        EMOJI_MAP.put(":smile:", "😄");
        EMOJI_MAP.put(":grin:", "😁");
        EMOJI_MAP.put(":joy:", "😂");
        EMOJI_MAP.put(":rofl:", "🤣");
        EMOJI_MAP.put(":wink:", "😉");
        EMOJI_MAP.put(":blush:", "😊");
        EMOJI_MAP.put(":sunglasses:", "😎");
        EMOJI_MAP.put(":thinking:", "🤔");
        EMOJI_MAP.put(":neutral:", "😐");
        EMOJI_MAP.put(":cry:", "😢");
        EMOJI_MAP.put(":sob:", "😭");
        EMOJI_MAP.put(":angry:", "😠");
        EMOJI_MAP.put(":rage:", "😡");
        EMOJI_MAP.put(":skull:", "💀");
        EMOJI_MAP.put(":fire:", "🔥");
        EMOJI_MAP.put(":thumbs:", "👍");
        EMOJI_MAP.put(":thumbsdown:", "👎");
        EMOJI_MAP.put(":heart:", "❤️");
        EMOJI_MAP.put(":broken_heart:", "💔");
        EMOJI_MAP.put(":100:", "💯");
        EMOJI_MAP.put(":star:", "⭐");
        EMOJI_MAP.put(":sparkles:", "✨");
        EMOJI_MAP.put(":zap:", "⚡");
        EMOJI_MAP.put(":check:", "✔️");
        EMOJI_MAP.put(":x:", "❌");
        EMOJI_MAP.put(":wave:", "👋");
        EMOJI_MAP.put(":clap:", "👏");
        EMOJI_MAP.put(":pray:", "🙏");
        EMOJI_MAP.put(":ok_hand:", "👌");
        EMOJI_MAP.put(":eyes:", "👀");
        EMOJI_MAP.put(":poop:", "💩");
        EMOJI_MAP.put(":alien:", "👽");
        EMOJI_MAP.put(":robot:", "🤖");
        EMOJI_MAP.put(":cat:", "🐱");
        EMOJI_MAP.put(":dog:", "🐶");
        EMOJI_MAP.put(":dragon:", "🐉");
        EMOJI_MAP.put(":ghost:", "👻");
        EMOJI_MAP.put(":pumpkin:", "🎃");
        EMOJI_MAP.put(":snowflake:", "❄️");
        EMOJI_MAP.put(":christmas_tree:", "🎄");
    }
    
    public static void createShortcut(String appName, String className, String iconFile) {
        try {
            String home = System.getProperty("user.home");
            File desktopFile = new File(home + "/.local/share/applications/" + appName + ".desktop");
    
            // Absolute path of the current project directory
            String appDir = new File(".").getCanonicalPath();
    
            // Absolute path for the icon file
            File icon = new File(appDir, iconFile);
            if (!icon.exists()) {
                System.err.println("Icon file not found: " + icon.getAbsolutePath());
            }
            String iconPath = icon.getAbsolutePath();
    
            // Exec line: Java class in default package
            String execLine = "/usr/bin/java -cp \"" + appDir + "\" " + className;
    
            // Build the desktop entry
            String content =
                    "[Desktop Entry]\n" +
                    "Version=1.0\n" +
                    "Type=Application\n" +
                    "Name=" + appName + "\n" +
                    "Exec=" + execLine + "\n" +
                    "Icon=" + iconPath + "\n" +
                    "Terminal=true\n" +
                    "StartupNotify=true\n" +
                    "Path=" + appDir + "\n" +
                    "Categories=Utility;\n";
    
            // Write the .desktop file
            try (FileWriter fw = new FileWriter(desktopFile)) {
                fw.write(content);
            }
    
            // Make it executable
            new ProcessBuilder("chmod", "+x", desktopFile.getAbsolutePath()).start().waitFor();
    
            // Mark trusted for GNOME
            new ProcessBuilder("gio", "set", desktopFile.getAbsolutePath(), "metadata::trusted", "true")
                    .start().waitFor();
    
            System.out.println("Shortcut created: " + desktopFile.getAbsolutePath());
    
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static void main(String[] args) {
        createShortcut("ChatroomServer", "ChatServer", "icon.png");
        if (!filesDir.exists()) filesDir.mkdir();
        else {
            // clear existing files
            for (File f : Objects.requireNonNull(filesDir.listFiles())) {
                if (!f.isDirectory()) {
                    f.delete();
                }
            }
        }
        // refresh index from disk
        for (File f : Objects.requireNonNull(filesDir.listFiles())) {
            fileIndex.put(f.getName(), f);
        }

        System.out.println("Chat server started on port " + PORT);
        System.out.println("Type /help for server commands.");

        // Thread for server console commands
        new Thread(() -> {
            try (Scanner scanner = new Scanner(System.in)) {
                while (true) {
                    String line = scanner.nextLine();
                    if (line.equalsIgnoreCase("/stop")) {
                        shutdownServer();
                        break;
                    }
                    if (line.equalsIgnoreCase("/help")) {
                        System.out.println(SERVER_HELP);
                        continue;
                    }
                    if (line.startsWith("/kick ")) {
                        String target = line.substring(6).trim();
                        kickUser(target);
                        continue;
                    }
                    if (!line.trim().isEmpty()) {
                        // console broadcast supports markup too
                        broadcast("📢 SERVER: " + line);
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }, "server-console").start();
        
        // start auto-update server
        new Thread(() -> {
            try (ServerSocket updateSocket = new ServerSocket(UPDATE_PORT)) {
                System.out.println("Auto-update server started on port " + UPDATE_PORT);
                while (true) {
                    Socket socket = updateSocket.accept();
                    new Thread(() -> handleFileServerRequest(socket)).start();
                }
            } catch (IOException e) {
                e.printStackTrace();
                System.out.println("Update server stopped.");
            }
        }, "update-server").start();

        // Start main chat server
        try (ServerSocket ss = new ServerSocket(PORT)) {
            serverSocket = ss;
            while (true) {
                Socket socket = serverSocket.accept();
                ClientHandler handler = new ClientHandler(socket);
                handler.start(); // add to clients after username is assigned
            }
        } catch (IOException e) {
            System.out.println("Server stopped.");
        }
        
    }
    
    private static String getLatestClientVersion(File chatClientFile) {
        try (BufferedReader br = new BufferedReader(new FileReader(chatClientFile))) {
            String line;
            while ((line = br.readLine()) != null) {
                line = line.trim();
                if (line.startsWith("private static final String CLIENT_VERSION")) {
                    // extract version between quotes
                    int start = line.indexOf("\"");
                    int end = line.lastIndexOf("\"");
                    if (start >= 0 && end > start) {
                        return line.substring(start + 1, end);
                    }
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return "0.0"; // fallback if not found
    }

    private static void shutdownServer() {
        broadcast("⚠️ Server disconnected");
        synchronized (clients) {
            for (ClientHandler client : clients) {
                try {
                    client.out.println("SERVER_CLOSED");
                    client.socket.close();
                } catch (IOException ignored) {}
            }
        }
        try { serverSocket.close(); } catch (IOException ignored) {}
        System.exit(0);
    }

    private static void kickUser(String target) {
        synchronized (clients) {
            for (ClientHandler client : clients) {
                if (client.username != null && client.username.equalsIgnoreCase(target)) {
                    client.out.println("[KICK] You have been kicked by the server.");
                    try { client.socket.close(); } catch (IOException ignored) {}
                    clients.remove(client);
                    broadcast("⛔ " + client.username + " was kicked by the server.");
                    break;
                }
            }
        }
    }

    private static String getUniqueUsername(String base) {
        String newName = (base == null || base.trim().isEmpty()) ? "Anonymous" : base.trim();
        int count = 1;
        synchronized (clients) {
            boolean exists;
            do {
                exists = false;
                for (ClientHandler c : clients) {
                    if (c.username != null && c.username.equalsIgnoreCase(newName)) {
                        exists = true;
                        newName = base + "(" + count + ")";
                        count++;
                        break;
                    }
                }
            } while (exists);
        }
        return newName;
    }

    // Recognizes a raw HTTP request line (what you get if something speaks
    // HTTP to this raw socket instead of the chat protocol — e.g. a
    // platform health check hitting the port directly). Matches the common
    // methods rather than trying to be exhaustive; anything that reaches
    // here failing this check just gets treated as a (probably weird, but
    // harmless) requested username, same as before.
    private static boolean looksLikeHttpRequest(String firstLine) {
        return firstLine.matches("^(GET|HEAD|POST|PUT|DELETE|OPTIONS|PATCH|TRACE|CONNECT) .* HTTP/\\d\\.\\d$");
    }

    private static class ClientHandler extends Thread {
        private final Socket socket;
        private PrintWriter out;
        private BufferedReader in;
        private String username;

        public ClientHandler(Socket socket) {
            super("client-" + socket.getPort());
            this.socket = socket;
        }

        public void run() {
            try {
                in  = new BufferedReader(new InputStreamReader(socket.getInputStream()));
                out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(socket.getOutputStream())), true);

                // First message is username (client sends it immediately)
                String requested = in.readLine();

                // Not a real chat client — most likely a plain HTTP request
                // (e.g. a platform health check hitting this raw socket port
                // directly) or a probe that connected and disconnected
                // without sending anything. Close quietly rather than
                // treating "HEAD / HTTP/1.1" etc. as someone's username —
                // that used to show up as a join/leave pair in everyone's
                // chat log for every single health-check ping.
                if (requested == null || looksLikeHttpRequest(requested)) {
                    return;
                }

                username = getUniqueUsername(requested);

                // Add to client set only after username determined
                synchronized (clients) { clients.add(this); }

                // Tell client final username (client expects this)
                out.println("[USERNAME] " + username);

                // Send chat history
                synchronized (messageHistory) {
                    for (String oldMsg : messageHistory) {
                        out.println(oldMsg);
                    }
                }

                // Send current user list
                sendUserList();

                // Tip
                out.println("[INFO] Type /help to view all commands");

                broadcast("🔵 " + username + " has joined the chat!");
                broadcastUserList();

                String message;
                while ((message = in.readLine()) != null) {
                    if (message.startsWith("/users")) {
                        sendUserList();
                        continue;
                    }
                    if (message.equals("/files")) {
                        out.println(listFilesLine());
                        continue;
                    }
                    if (message.startsWith("/typing")) {
                        broadcastTyping(username);
                        continue;
                    }
                    if (message.startsWith("/file ")) {
                        handleFileUpload(message);
                        continue;
                    }

                    // Normal chat: emoji + markup normalization is done server-side globally
                    String parsedMessage = applyGlobalParsing(message);
                    broadcast(username + ": " + parsedMessage);
                }
            } catch (IOException e) {
                System.out.println((username != null ? username : "unknown") + " disconnected.");
            } finally {
                try { socket.close(); } catch (IOException ignored) {}
                clients.remove(this);
                if (username != null) {
                    broadcast("🔴 " + username + " has left the chat!");
                    broadcastUserList();
                }
            }
        }

        private void sendUserList() {
            StringBuilder sb = new StringBuilder("👥 Online: ");
            synchronized (clients) {
                for (ClientHandler client : clients) {
                    sb.append(client.username).append(", ");
                }
            }
            if (sb.length() > 2) sb.setLength(sb.length() - 2);
            out.println(sb.toString());
        }
        
        private static void broadcastUserList() {
            synchronized (clients) {
                for (ClientHandler client : clients) {
                    client.sendUserList();
                }
            }
        }

        private String listFilesLine() {
            File[] files = filesDir.listFiles();
            if (files == null || files.length == 0) return "📂 No files uploaded.";
            StringBuilder sb = new StringBuilder("📂 Files: ");
            for (File f : files) {
                sb.append(f.getName()).append(" (").append(f.length()).append(" bytes), ");
            }
            if (sb.length() > 2) sb.setLength(sb.length() - 2);
            return sb.toString();
        }

        // Supports:
        // 1) New client:   /file <filename> <base64>
        // 2) Legacy flow:  /file <filename> <size>  (followed by <size> raw bytes on the same socket)
        private void handleFileUpload(String command) {
            try {
                String[] parts = command.split(" ", 3);
                if (parts.length < 3) {
                    out.println("[ERROR] Usage: /file <filename> <base64 | size>");
                    return;
                }

                String rawName = parts[1];
                String filename = sanitizeFilename(rawName);

                // If 3rd token is a number, treat as legacy size+raw-bytes flow
                Long sizeIfNumeric = tryParseLong(parts[2]);
                if (sizeIfNumeric != null) {
                    long size = sizeIfNumeric;
                    File outFile = uniqueFile(filesDir, filename);
                    // Informational line (optional; the client doesn't rely on it)
                    out.println("[INFO] Ready to receive file: " + outFile.getName() + " (" + size + " bytes)");

                    // Read raw bytes directly from the socket InputStream
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        InputStream is = socket.getInputStream();
                        byte[] buffer = new byte[4096];
                        long remaining = size;
                        while (remaining > 0) {
                            int read = is.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                            if (read < 0) break;
                            fos.write(buffer, 0, read);
                            remaining -= read;
                        }
                    }

                    fileIndex.put(outFile.getName(), outFile);
                    broadcast("📎 " + username + " uploaded file: " + outFile.getName() +
                              " (" + size + " bytes). Download with /files");
                    return;
                }

                // Otherwise treat parts[2] as base64
                String base64 = parts[2];
                byte[] data;
                try {
                    data = Base64.getDecoder().decode(base64);
                } catch (IllegalArgumentException iae) {
                    out.println("[ERROR] Invalid Base64 data.");
                    return;
                }

                File outFile = uniqueFile(filesDir, filename);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(data);
                }

                fileIndex.put(outFile.getName(), outFile);
                broadcast("📎 " + username + " uploaded file: " + outFile.getName() +
                          " (" + outFile.length() + " bytes). Download with /files");

            } catch (Exception e) {
                out.println("[ERROR] File upload failed: " + e.getMessage());
            }
        }
    }
    
    private static void handleFileServerRequest(Socket socket) {
        try (DataInputStream dis = new DataInputStream(socket.getInputStream());
             DataOutputStream dos = new DataOutputStream(socket.getOutputStream())) {
    
            // Read client message (either version string like "1.091" or filename)
            String header = dis.readUTF().trim();
    
            File chatClientFile = new File("ChatClient.java");
    
            // Auto-update: client sends its version string
            if (header.matches("\\d+(\\.\\d+)*") || header.equals("ChatClient.java")) {
                String clientVersion = header;
                String latestVersion = getLatestClientVersion(chatClientFile);
            
                if (!chatClientFile.exists()) {
                    // If file missing, just pretend no update (send current client version back)
                    dos.writeUTF(clientVersion);
                    return;
                }
            
                // Always reply with the latest version string
                dos.writeUTF(latestVersion);
            
                if (!clientVersion.equals(latestVersion)) {
                    // Send file only if outdated
                    dos.writeUTF(chatClientFile.getName());
                    dos.writeLong(chatClientFile.length());
            
                    try (FileInputStream fis = new FileInputStream(chatClientFile)) {
                        byte[] buffer = new byte[4096];
                        int read;
                        while ((read = fis.read(buffer)) != -1) {
                            dos.write(buffer, 0, read);
                        }
                    }
            
                    System.out.println("✅ Sent update to client: v" + latestVersion);
                } else {
                    System.out.println("✅ Client already up-to-date: v" + clientVersion);
                }
                return;
            } else if (header.startsWith("GET_FILE:")) {
                String filename = sanitizeFilename(header.substring("GET_FILE:".length()));
                File requestedFile = new File(filesDir, filename);
            
                if (!requestedFile.exists() || !requestedFile.isFile()) {
                    dos.writeUTF("NO_FILE");
                    return;
                }
            
                dos.writeUTF("FILE_OK");
                dos.writeLong(requestedFile.length());
            
                try (FileInputStream fis = new FileInputStream(requestedFile)) {
                    byte[] buffer = new byte[4096];
                    int read;
                    while ((read = fis.read(buffer)) != -1) {
                        dos.write(buffer, 0, read);
                    }
                }
            
                System.out.println("✅ Served file: " + requestedFile.getName() +
                                   " to " + socket.getInetAddress());
            }else if (header.equals("LIST_FILES")) {
                File[] list = filesDir.listFiles((dir, name) -> new File(dir, name).isFile());
                if (list == null || list.length == 0) {
                    dos.writeUTF("NO_FILES");
                } else {
                    StringBuilder sb = new StringBuilder();
                    for (int i = 0; i < list.length; i++) {
                        sb.append(list[i].getName());
                        if (i < list.length - 1) sb.append(",");
                    }
                    dos.writeUTF(sb.toString());
                }
                return;
            }
        } catch (EOFException | UTFDataFormatException e) {
            // dis.readUTF() expects a 2-byte length-prefixed string; a plain
            // HTTP request line (e.g. a platform health check hitting this
            // port directly) or any other non-protocol connection doesn't
            // look anything like that, and reliably lands here rather than
            // in the "real" I/O error case below. That's expected traffic
            // for a raw port sitting on the open internet, not a server
            // malfunction — nothing useful to log per occurrence.
        } catch (IOException e) {
            System.out.println("❌ File server error: " + e.getMessage());
        } finally {
            try { socket.close(); } catch (IOException ignored) {}
        }
    }



    // ---- broadcast + typing ----

    private static void broadcast(String msg) {
        // Global parsing of user/console messages (emojis + markup normalization)
        String body = applyGlobalParsing(msg);

        String message = "[" + timeFormat.format(new Date()) + "] " + body;

        synchronized (clients) {
            for (ClientHandler client : clients) {
                client.out.println(message);
            }
        }

        synchronized (messageHistory) {
            messageHistory.add(message);
            if (messageHistory.size() > MAX_HISTORY) {
                messageHistory.remove(0);
            }
        }

        System.out.println(message);
    }

    private static void broadcastTyping(String user) {
        synchronized (clients) {
            for (ClientHandler client : clients) {
                if (client.username != null && !client.username.equals(user)) {
                    client.out.println("[TYPING] " + user + " is typing…");
                }
            }
        }
    }

    // ---- emoji + markup (global) ----

    private static String applyGlobalParsing(String msg) {
        // order: first emoji replacements, then markup normalization
        String withEmojis = replaceEmojis(msg);
        return normalizeMarkup(withEmojis);
    }

    private static String replaceEmojis(String msg) {
        for (Map.Entry<String, String> entry : EMOJI_MAP.entrySet()) {
            msg = msg.replace(entry.getKey(), entry.getValue());
        }
        return msg;
    }



    /**
     * Normalize custom markup:
     * - Supports [b] [/b], [i] [/i], [u] [/u]
     * - Ignores unknown bracketed tokens
     * - Discards stray closing tags
     * - Auto-closes any leftover open tags at the end (LIFO)
     * - Does NOT touch bracketed timestamps like [12:34]
     */
    private static String normalizeMarkup(String input) {
        if (input == null || input.isEmpty()) return input;

        final String[] OPEN_TAGS  = {"[b]", "[i]", "[u]"};
        final String[] CLOSE_TAGS = {"[/b]", "[/i]", "[/u]"};
        final Map<String, String> OPEN_TO_CLOSE = new HashMap<>();
        OPEN_TO_CLOSE.put("[b]", "[/b]");
        OPEN_TO_CLOSE.put("[i]", "[/i]");
        OPEN_TO_CLOSE.put("[u]", "[/u]");

        final Map<String, String> CLOSE_TO_OPEN = new HashMap<>();
        CLOSE_TO_OPEN.put("[/b]", "[b]");
        CLOSE_TO_OPEN.put("[/i]", "[i]");
        CLOSE_TO_OPEN.put("[/u]", "[u]");

        Deque<String> stack = new ArrayDeque<>();
        StringBuilder out = new StringBuilder();

        int i = 0;
        while (i < input.length()) {
            // try to match known open/close tokens
            String token = null;

            // check open tokens
            for (String t : OPEN_TAGS) {
                if (input.startsWith(t, i)) { token = t; break; }
            }
            // check close tokens
            if (token == null) {
                for (String t : CLOSE_TAGS) {
                    if (input.startsWith(t, i)) { token = t; break; }
                }
            }

            if (token == null) {
                // normal char
                out.append(input.charAt(i));
                i++;
                continue;
            }

            // handle token
            if (OPEN_TO_CLOSE.containsKey(token)) {
                // opening tag
                stack.push(token);
                out.append(token);
            } else {
                // closing tag
                String neededOpen = CLOSE_TO_OPEN.get(token);
                if (neededOpen == null) {
                    // unknown token, ignore
                } else if (stack.isEmpty()) {
                    // stray closing, drop it
                } else {
                    // pop until matching
                    while (!stack.isEmpty() && !stack.peek().equals(neededOpen)) {
                        out.append(OPEN_TO_CLOSE.get(stack.pop())); // auto-close mismatched open
                    }
                    if (!stack.isEmpty() && stack.peek().equals(neededOpen)) {
                        stack.pop();
                        out.append(token); // append the actual closing tag
                    }
                }
            }
            i += token.length();
        }

        // close any remaining open tags
        while (!stack.isEmpty()) {
            out.append(OPEN_TO_CLOSE.get(stack.pop()));
        }

        return out.toString();
    }

    // ---- helpers: filenames, numbers, unique files ----

    private static String sanitizeFilename(String name) {
        if (name == null) return "file";
        // keep letters, digits, dot, dash, underscore; strip the rest
        String cleaned = name.replaceAll("[^A-Za-z0-9._-]", "_");
        // prevent sneaky parent dirs
        cleaned = cleaned.replace("..", "_");
        if (cleaned.isEmpty()) cleaned = "file";
        return cleaned;
    }

    private static Long tryParseLong(String s) {
        try { return Long.parseLong(s); } catch (Exception ignored) { return null; }
    }

    private static File uniqueFile(File dir, String baseName) {
        File f = new File(dir, baseName);
        if (!f.exists()) return f;
        String name = baseName;
        String stem = name;
        String ext  = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            stem = name.substring(0, dot);
            ext  = name.substring(dot); // includes dot
        }
        int i = 1;
        do {
            f = new File(dir, stem + "(" + i + ")" + ext);
            i++;
        } while (f.exists());
        return f;
    }
}
