pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // Maven Central rate-limits Robolectric's very large jars per IP. A build machine that
        // hits the limit can point this one test-only group at a mirror of Maven Central:
        //   ./gradlew test -Pshelfmark.robolectricMirror=<mirror url>
        // Off by default, nothing changes unless the property is set.
        providers.gradleProperty("shelfmark.robolectricMirror").orNull?.let { mirror ->
            exclusiveContent {
                forRepository { maven(mirror) { name = "RobolectricMirror" } }
                filter { includeGroup("org.robolectric") }
            }
        }
        google()
        mavenCentral()
    }
}

rootProject.name = "Shelfmark"
include(":app")
