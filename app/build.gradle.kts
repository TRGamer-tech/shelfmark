import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// One stable signing key for debug and release builds, so every build installs over the
// one before it and the library on the phone survives. The key is never in the repository.
// It comes from keystore.properties next to settings.gradle.kts (storeFile, storePassword,
// keyAlias, keyPassword), or from the environment (the release workflow does that).
// Without a key the builds still work, signed with the debug key of the machine.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

fun signing(property: String, variable: String): String? =
    keystoreProps.getProperty(property)?.takeIf { it.isNotBlank() } ?: System.getenv(variable)?.takeIf { it.isNotBlank() }

val signingStore = signing("storeFile", "SHELFMARK_KEYSTORE_FILE")
val signingPassword = signing("storePassword", "SHELFMARK_KEYSTORE_PASSWORD")

android {
    namespace = "ch.schmidtbit.shelfmark"
    compileSdk {
        version = release(37) { minorApiLevel = 2 }
    }

    defaultConfig {
        applicationId = "ch.schmidtbit.shelfmark"
        minSdk = 26
        targetSdk = 36
        // Raise versionCode with every release, Android refuses to install a lower one over a higher one.
        versionCode = 2
        versionName = "1.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // The text recognition library is about 10 MB per processor type. 32 bit Intel
        // phones no longer exist, x86_64 stays for emulators.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }

    signingConfigs {
        if (signingStore != null && signingPassword != null) {
            create("shelfmark") {
                storeFile = rootProject.file(signingStore)
                storePassword = signingPassword
                keyAlias = signing("keyAlias", "SHELFMARK_KEY_ALIAS") ?: "shelfmark"
                keyPassword = signing("keyPassword", "SHELFMARK_KEY_PASSWORD") ?: signingPassword
            }
        }
    }

    buildTypes {
        debug {
            // Same key as the release build: a debug build updates an installed app instead of refusing to install.
            signingConfigs.findByName("shelfmark")?.let { signingConfig = it }
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("shelfmark") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all {
                it.systemProperty("roborazzi.test.record", "true")
                it.systemProperty("robolectric.graphicsMode", "NATIVE")
                it.maxHeapSize = "2g"
                // Same opt-in mirror as in settings.gradle.kts, for the SDK jars Robolectric fetches at run time.
                providers.gradleProperty("shelfmark.robolectricMirror").orNull?.let { mirror ->
                    it.systemProperty("robolectric.dependency.repo.url", mirror.trimEnd('/'))
                }
            }
        }
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
    arg("room.generateKotlin", "true")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.extended)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    implementation(libs.room.runtime)
    ksp(libs.room.compiler)

    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)

    implementation(libs.mlkit.text.recognition)
    implementation(libs.zxing.core)

    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
}
