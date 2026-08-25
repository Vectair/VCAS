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

    // MapLibre Native Android SDK (2026-08-25, phase 2). Unlike
    // androidx.car.app above, this IS mavenCentral()-hosted (confirmed by
    // actually downloading this exact version's .aar from
    // repo1.maven.org, not assumed) — so this version pin is genuinely
    // verified reachable, even though nothing that USES it could be
    // compiled here. 11.7.0 specifically (not the newer 13.5.1 latest at
    // time of writing) to match the real, working reference this phase's
    // Surface-rendering approach was adapted from
    // (maplibre/MapLibre-Android-Auto-Sample) — matching a version a real
    // sample is confirmed to build against beats guessing "latest" is
    // still compatible with the VirtualDisplay/Presentation approach.
    // The SDK's own embedded manifest declares minSdkVersion 21 (checked
    // directly against the downloaded .aar) — well under this project's
    // existing minSdk 23, so no bump was needed for this dependency
    // alone.
    implementation("org.maplibre.gl:android-sdk:11.7.0")

    // JUnit 4 for pure-JVM unit tests (src/test/java — no device/emulator
    // needed, runs via Gradle's `test` task or Android Studio's own test
    // runner). Added 2026-08-25 for the geo.js -> Geo.kt port's own test
    // suite (see GeoTest.kt) — this is mavenCentral()-hosted, not
    // dl.google.com, so unlike androidx.car.app above this version WAS
    // resolvable/verifiable from this sandbox.
    testImplementation("junit:junit:4.13.2")

    // Real org.json implementation for LOCAL unit tests only (2026-08-25,
    // ADS-B follow-up — NormaliseAircraftTest.kt). Android's own SDK
    // bundles org.json at runtime (so NormaliseAircraft.kt itself needs
    // no dependency line at all for the real app build), but local
    // src/test/java unit tests run on the plain host JVM, not a device —
    // Android's own android.jar stub throws on most platform classes
    // there, and org.json is one of them. This standard, widely-used
    // pattern (a real org.json:json artifact, testImplementation-scoped
    // so it never reaches the actual APK) supplies a working
    // implementation for exactly that gap. Verified reachable the same
    // way as the MapLibre SDK above — this version's .jar was actually
    // downloaded from repo1.maven.org, not assumed.
    testImplementation("org.json:json:20240303")
}
