extension {
    name = "extensions/extension.mpe"
}

android {
    namespace = "app.tvpatches.extension"
}

// The scripts in src/main/js are joined (runtime.js first, then the rest in name order) and
// embedded as a Java string constant: TvScriptsPayload.SCRIPT.
// Idea from ysamjo/morphe-patches (GPLv3).
abstract class GenerateTvScriptsPayload : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val scripts: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty

    @get:Input
    abstract val version: Property<String>

    // All scripts run as one bundle, so a syntax error in any of them disables every FaroTV feature.
    // Each file is checked with "node --check" (Node.js is installed in the release workflow);
    // without Node.js the check is skipped with a warning.
    private fun checkSyntax(files: List<java.io.File>) {
        val node = try {
            ProcessBuilder("node", "--version").redirectErrorStream(true).start().also { it.waitFor() }
            "node"
        } catch (e: Exception) {
            logger.warn("Node.js not found: the scripts in src/main/js are not syntax checked.")
            return
        }
        val errors = files.mapNotNull { file ->
            val process = ProcessBuilder(node, "--check", file.absolutePath).redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().readText()
            if (process.waitFor() == 0) null else "${file.name}:\n$output"
        }
        if (errors.isNotEmpty()) throw GradleException("JavaScript syntax errors:\n" + errors.joinToString("\n"))
    }

    @TaskAction
    fun generate() {
        val files = scripts.get().asFile.listFiles { f -> f.name.endsWith(".js") }!!
            .sortedWith(compareBy({ it.name != "runtime.js" }, { it.name }))
        checkSyntax(files)
        // The bundle version, shown in Settings > Acerca de.
        val lines = listOf("window.__farotvVersion = \"${version.get()}\";") + files.flatMap { file ->
            listOf("// ---- ${file.name}") + file.readText(Charsets.UTF_8).lines()
        }
        // Non-ASCII characters (accents in the Spanish texts) become \uXXXX escapes, so the
        // generated Java file does not depend on the compiler's source encoding.
        fun escape(line: String) = buildString {
            for (c in line) when {
                c == '\\' -> append("\\\\")
                c == '"' -> append("\\\"")
                c == '\t' -> append("    ")
                c.code < 32 -> {}
                c.code < 128 -> append(c)
                else -> append("\\u%04x".format(c.code))
            }
        }
        val literal = lines.joinToString("\n            + ") { line -> "\"" + escape(line) + "\\n\"" }
        val target = outputDirectory.file("app/tvpatches/extension/youtubetv/TvScriptsPayload.java").get().asFile
        target.parentFile.mkdirs()
        target.writeText(
            "package app.tvpatches.extension.youtubetv;\n" +
                "final class TvScriptsPayload {\n    static final String SCRIPT = $literal;\n" +
                "    private TvScriptsPayload() {}\n}\n"
        )
    }
}

androidComponents.onVariants { variant ->
    val task = tasks.register<GenerateTvScriptsPayload>(
        "generate${variant.name.replaceFirstChar { it.uppercaseChar() }}TvScriptsPayload"
    ) {
        scripts.set(layout.projectDirectory.dir("src/main/js"))
        version.set(project.version.toString())
    }
    variant.sources.java?.addGeneratedSourceDirectory(task, GenerateTvScriptsPayload::outputDirectory)
}
