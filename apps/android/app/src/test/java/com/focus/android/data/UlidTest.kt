package com.focus.android.data

import org.junit.Assert.assertTrue
import org.junit.Test

class UlidTest {
    @Test
    fun generatedClientIdsMatchServerUlidRegex() {
        val regex = Regex("^[0-9A-HJKMNP-TV-Z]{26}$")

        repeat(100) {
            assertTrue(regex.matches(newUlid()))
        }
    }
}
