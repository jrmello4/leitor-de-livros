import java.security.MessageDigest
import java.time.Instant
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Fonte única de versionamento via version.properties
val versionProps = Properties().apply {
    val propFile = rootProject.file("version.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { stream ->
            this.load(stream)
        }
    }
}
val verMajor = (versionProps.getProperty("versionMajor") ?: "0").toInt()
val verMinor = (versionProps.getProperty("versionMinor") ?: "4").toInt()
val verPatch = (versionProps.getProperty("versionPatch") ?: "0").toInt()
val baseVerCode = (versionProps.getProperty("versionCode") ?: "4").toInt()
val effectiveVersionCode = System.getenv("TACTILE_VERSION_CODE")?.toIntOrNull() ?: baseVerCode
val effectiveVersionName = "$verMajor.$verMinor.$verPatch"

val appMinSdk = 26
val appTargetSdk = 35
val appCompileSdk = 35

// Assinatura de release via ambiente (CI) com fallback para debug em testes locais
val storeFilePath = System.getenv("TACTILE_STORE_FILE")
val storePassword = System.getenv("TACTILE_STORE_PASSWORD")
val keyAlias = System.getenv("TACTILE_KEY_ALIAS")
val keyPassword = System.getenv("TACTILE_KEY_PASSWORD")
val hasSigning = !storeFilePath.isNullOrBlank() && !storePassword.isNullOrBlank() &&
    !keyAlias.isNullOrBlank() && !keyPassword.isNullOrBlank()

android {
    namespace = "com.jrmello4.tactilereader.scaffold"
    compileSdk = appCompileSdk

    defaultConfig {
        applicationId = "com.jrmello4.tactilereader.scaffold"
        minSdk = appMinSdk
        targetSdk = appTargetSdk
        versionCode = effectiveVersionCode
        versionName = effectiveVersionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "VERSION_NAME", "\"$effectiveVersionName\"")
        buildConfigField("int", "VERSION_CODE", "$effectiveVersionCode")
    }

    if (hasSigning) {
        signingConfigs {
            create("release") {
                storeFile = rootDir.resolve(storeFilePath)
                this.storePassword = storePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = if (hasSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
        debug {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = false
        disable += setOf("GradleDependency", "OldTargetApi")
    }

    applicationVariants.all {
        val variant = this
        variant.outputs.all {
            val output = this as? com.android.build.gradle.internal.api.BaseVariantOutputImpl
            if (output != null) {
                val type = variant.buildType.name
                output.outputFileName = "tactile-native-${effectiveVersionName}+${effectiveVersionCode}-${type}.apk"
            }
        }
    }
}

// O núcleo é Kotlin puro: sem NDK, sem cargo, sem .so por ABI.
// Bibliotecas de arquivo: junrar (RAR4/RAR5, licença UnRAR — só extração),
// commons-compress + xz (7z) e slf4j-nop para silenciar o binding do junrar.

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    testImplementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("io.coil-kt.coil3:coil-compose:3.0.4")
    implementation("com.github.junrar:junrar:8.1.1")
    implementation("org.apache.commons:commons-compress:1.28.0")
    implementation("org.tukaani:xz:1.10")
    runtimeOnly("org.slf4j:slf4j-nop:2.0.17")

    // ProfileInstaller para Baseline Profiles oficiais
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}

tasks.register("generateReleaseMetadata") {
    dependsOn("assembleRelease")
    doLast {
        val releaseDir = layout.buildDirectory.dir("outputs/apk/release").get().asFile
        val apk = releaseDir.listFiles()?.firstOrNull { it.name.endsWith(".apk") && !it.name.contains("-unaligned") }
        if (apk == null || !apk.exists()) {
            println("APK de release não encontrado em $releaseDir")
            return@doLast
        }

        val isReleaseSigned = hasSigning
        val requireReleaseSigning = System.getenv("REQUIRE_RELEASE_SIGNING") == "true"
        if (requireReleaseSigning && !isReleaseSigned) {
            throw GradleException("Build oficial de release rejeitado: REQUIRE_RELEASE_SIGNING está ativo, mas as credenciais de assinatura de release não foram configuradas! Não é permitido publicar APK com assinatura de debug.")
        }

        val signingType = if (isReleaseSigned) "release-signed" else "debug-signed"
        val isPublishable = isReleaseSigned

        val digest = MessageDigest.getInstance("SHA-256")
        apk.inputStream().use { input ->
            val buf = ByteArray(16384)
            while (true) {
                val read = input.read(buf)
                if (read <= 0) break
                digest.update(buf, 0, read)
            }
        }
        val sha256 = digest.digest().joinToString("") { b -> "%02x".format(b) }
        val sizeBytes = apk.length()

        val manifestContent = """
{
  "name": "tactile-native",
  "versionName": "$effectiveVersionName",
  "versionCode": $effectiveVersionCode,
  "buildType": "release",
  "minSdkVersion": $appMinSdk,
  "targetSdkVersion": $appTargetSdk,
  "compileSdkVersion": $appCompileSdk,
  "packageName": "${android.namespace}",
  "apkName": "${apk.name}",
  "sha256": "$sha256",
  "sizeBytes": $sizeBytes,
  "signing": "$signingType",
  "publishable": $isPublishable,
  "signatureScheme": "v2",
  "generatedAt": "${Instant.now()}"
}
""".trimIndent()

        val rootManifest = rootProject.file("../release-manifest.json")
        rootManifest.writeText(manifestContent)
        File(releaseDir, "release-manifest.json").writeText(manifestContent)

        val sbomContent = """
{
  "${'$'}schema": "http://cyclonedx.org/schema/bom-1.5.json",
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "serialNumber": "urn:uuid:6a978f13-4357-4148-9366-0d1743fcfd74",
  "version": 1,
  "metadata": {
    "timestamp": "${Instant.now()}",
    "tools": [
      {
        "vendor": "Tactile Reader Build System",
        "name": "tactile-sbom-generator",
        "version": "$effectiveVersionName"
      }
    ],
    "component": {
      "type": "application",
      "name": "tactile-native",
      "version": "$effectiveVersionName+$effectiveVersionCode",
      "description": "Leitor nativo editorial offline de quadrinhos e mangás para Android",
      "purl": "pkg:maven/com.jrmello4.tactilereader/app@$effectiveVersionName"
    }
  },
  "components": [
    {
      "type": "library",
      "name": "androidx.compose.ui:ui",
      "version": "1.7.4",
      "description": "Jetpack Compose UI Core",
      "licenses": [{ "license": { "id": "Apache-2.0" } }],
      "purl": "pkg:maven/androidx.compose.ui/ui@1.7.4"
    },
    {
      "type": "library",
      "name": "androidx.compose.material3:material3",
      "version": "1.3.0",
      "description": "Jetpack Compose Material 3 Components",
      "licenses": [{ "license": { "id": "Apache-2.0" } }],
      "purl": "pkg:maven/androidx.compose.material3/material3@1.3.0"
    },
    {
      "type": "library",
      "name": "androidx.activity:activity-compose",
      "version": "1.9.3",
      "description": "Compose integration with Android Activity",
      "licenses": [{ "license": { "id": "Apache-2.0" } }],
      "purl": "pkg:maven/androidx.activity/activity-compose@1.9.3"
    },
    {
      "type": "library",
      "name": "androidx.core:core-ktx",
      "version": "1.13.1",
      "description": "Android KTX extensions",
      "licenses": [{ "license": { "id": "Apache-2.0" } }],
      "purl": "pkg:maven/androidx.core/core-ktx@1.13.1"
    },
    {
      "type": "library",
      "name": "androidx.lifecycle:lifecycle-viewmodel-compose",
      "version": "2.8.6",
      "description": "Lifecycle ViewModel Compose integration",
      "licenses": [{ "license": { "id": "Apache-2.0" } }],
      "purl": "pkg:maven/androidx.lifecycle/lifecycle-viewmodel-compose@2.8.6"
    },
    {
      "type": "library",
      "name": "androidx.profileinstaller:profileinstaller",
      "version": "1.4.1",
      "description": "AndroidX ProfileInstaller for ART Baseline Profiles",
      "licenses": [{ "license": { "id": "Apache-2.0" } }],
      "purl": "pkg:maven/androidx.profileinstaller/profileinstaller@1.4.1"
    },
    {
      "type": "library",
      "name": "io.coil-kt.coil3:coil-compose",
      "version": "3.0.4",
      "description": "Asynchronous Image Loading for Compose",
      "licenses": [{ "license": { "id": "Apache-2.0" } }],
      "purl": "pkg:maven/io.coil-kt.coil3/coil-compose@3.0.4"
    },
    {
      "type": "library",
      "name": "com.github.junrar:junrar",
      "version": "8.1.1",
      "description": "Pure Java RAR archive extraction (RAR4 and RAR5)",
      "licenses": [{ "license": { "name": "UnRAR License" } }],
      "purl": "pkg:maven/com.github.junrar/junrar@8.1.1"
    },
    {
      "type": "library",
      "name": "org.apache.commons:commons-compress",
      "version": "1.28.0",
      "description": "Apache Commons Compress for 7z, ZIP and Tar",
      "licenses": [{ "license": { "id": "Apache-2.0" } }],
      "purl": "pkg:maven/org.apache.commons/commons-compress@1.28.0"
    },
    {
      "type": "library",
      "name": "org.tukaani:xz",
      "version": "1.10",
      "description": "XZ and 7-Zip compression and decompression support",
      "licenses": [{ "license": { "id": "CC0-1.0", "name": "Public Domain" } }],
      "purl": "pkg:maven/org.tukaani/xz@1.10"
    },
    {
      "type": "library",
      "name": "org.slf4j:slf4j-nop",
      "version": "2.0.17",
      "description": "SLF4J No-Operation Logger Binding",
      "licenses": [{ "license": { "id": "MIT" } }],
      "purl": "pkg:maven/org.slf4j/slf4j-nop@2.0.17"
    }
  ]
}
""".trimIndent()
        val rootSbom = rootProject.file("../sbom.json")
        rootSbom.writeText(sbomContent)
        File(releaseDir, "sbom.json").writeText(sbomContent)

        println("Manifesto de release gerado: ${rootManifest.absolutePath}")
        println("SBOM gerado: ${rootSbom.absolutePath}")
        println("APK: ${apk.name}, Tamanho: ${sizeBytes / 1024} KB, Assinatura: $signingType, Publicável: $isPublishable, SHA-256: $sha256")
    }
}
