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

    defaultConfig {
        applicationId = "com.jrmello4.tactilereader.scaffold"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("TACTILE_VERSION_CODE")?.toIntOrNull() ?: 4)
        versionName = "0.4.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Assinatura de release via ambiente (CI). Sem as quatro variáveis, o
    // assembleRelease sai sem assinatura e o workflow de release falha cedo
    // com mensagem clara em vez de publicar APK inválido.
    val storeFilePath = System.getenv("TACTILE_STORE_FILE")
    val storePassword = System.getenv("TACTILE_STORE_PASSWORD")
    val keyAlias = System.getenv("TACTILE_KEY_ALIAS")
    val keyPassword = System.getenv("TACTILE_KEY_PASSWORD")
    val hasSigning = !storeFilePath.isNullOrBlank() && !storePassword.isNullOrBlank() &&
        !keyAlias.isNullOrBlank() && !keyPassword.isNullOrBlank()
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
            isMinifyEnabled = false
            if (hasSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    buildFeatures {
        compose = true
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
}

// O núcleo agora é Kotlin puro: sem NDK, sem cargo, sem .so por ABI.
// Bibliotecas de arquivo: junrar (RAR4/RAR5, licença UnRAR — só extração),
// commons-compress + xz (7z) e slf4j-nop para silenciar o binding do junrar.

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    testImplementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    // Ícones Material do núcleo (o Material3 já traz o core; o estendido
    // conflita no classpath e quebra o `Icons.Filled`). Só nomes que
    // existem no core: Add, Check, Close, MoreVert, Settings, Star,
    // Favorite e ArrowBack espelhada. Sem icone = texto em PT-BR.
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.9.3")
    // FileProvider do instalador in-app (a activity já traz o core junto;
    // a declaração explícita trava o artifact para o manifest merger).
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    // Capas lazy da estante: carrega o arquivo garantido pelo núcleo com
    // limite de memória/tamanho; placeholder de cor permanece no erro.
    implementation("io.coil-kt.coil3:coil-compose:3.0.4")
    // CBR/RAR4/RAR5 em Java puro (junrar 8.x; o 7.x não lia RAR5).
    implementation("com.github.junrar:junrar:8.1.1")
    // 7z em Java puro (Apache Commons Compress + XZ para LZMA/LZMA2).
    implementation("org.apache.commons:commons-compress:1.28.0")
    implementation("org.tukaani:xz:1.10")
    runtimeOnly("org.slf4j:slf4j-nop:2.0.17")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
