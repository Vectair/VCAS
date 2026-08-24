plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.vectair.vcas.car"
    // 34 is a reasonable current baseline as of writing — bump to whatever
    // Android Studio's SDK Manager offers as latest when this is first
    // opened for real (see android/README.md — unverified from this sandbox).
    compileSdk = 34

    defaultConfig {
        applicationId = "org.vectair.vcas.car"
        // 23 is the Car App Library's own documented minimum — not raised
        // further here since nothing in phase 1 needs a newer API.
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "0.1-phase1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Version unverified against a live Maven check — this sandbox can't
    // reach dl.google.com (see android/README.md). Confirm/bump against
    // the current androidx.car.app release when first building for real.
    implementation("androidx.car.app:app:1.4.0")
    implementation("androidx.core:core-ktx:1.13.1")
}
