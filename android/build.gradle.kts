// Root build file — plugin versions declared here, applied per-module below.
// Versions are a reasonable-as-of-writing baseline, not pinned against a
// live check (this sandbox can't reach dl.google.com — see android/README.md)
// — bump these to whatever Android Studio suggests as current when this is
// first opened for real.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
