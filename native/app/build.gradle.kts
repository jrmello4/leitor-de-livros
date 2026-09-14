plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    // Sufixo `.scaffold` para coexistir no aparelho com o APK Tauri publicado.
    // O app nativo final reassume o identificador do produto.
    namespace = "com.jrmello4.tactilereader.scaffold"
    compileSdk = 35
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "com.jrmello4.tactilereader.scaffold"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    buildFeatures {
        compose = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

// Compila o núcleo Rust para cada ABI e copia o .so para jniLibs.
// Requer Rust + targets Android instalados e o NDK acima.
val abiTargets = mapOf(
    "arm64-v8a" to "aarch64-linux-android",
    "x86_64" to "x86_64-linux-android",
)

val hostOs = System.getProperty("os.name").lowercase()
val hostTag = when {
    hostOs.contains("win") -> "windows-x86_64"
    hostOs.contains("mac") -> "darwin-x86_64"
    else -> "linux-x86_64"
}
val clangExt = if (hostOs.contains("win")) ".cmd" else ""

val copyCoreSoTasks = abiTargets.map { (abi, target) ->
    val envName = target.uppercase().replace("-", "_")
    val buildTask = tasks.register<Exec>("cargoBuildCore${abi.replace("-", "_")}") {
        val ndkBin = android.ndkDirectory
            .resolve("toolchains/llvm/prebuilt/$hostTag/bin")
        workingDir(rootDir.resolve("../src-tauri"))
        commandLine("cargo", "build", "--release", "-p", "tactile-core", "--target", target)
        environment("ANDROID_NDK_HOME", android.ndkDirectory.absolutePath)
        environment("CC_${envName}", ndkBin.resolve("${target}35-clang${clangExt}").absolutePath)
        environment("AR_${envName}", ndkBin.resolve("llvm-ar${if (hostOs.contains("win")) ".exe" else ""}").absolutePath)
        environment("CARGO_TARGET_${envName}_LINKER", ndkBin.resolve("${target}35-clang${clangExt}").absolutePath)
    }
    tasks.register<Copy>("copyCoreSo${abi.replace("-", "_")}") {
        dependsOn(buildTask)
        from(rootDir.resolve("../src-tauri/target/$target/release/libtactile_core.so"))
        into(layout.projectDirectory.dir("src/main/jniLibs/$abi"))
    }
}

tasks.named("preBuild") {
    dependsOn(copyCoreSoTasks)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
