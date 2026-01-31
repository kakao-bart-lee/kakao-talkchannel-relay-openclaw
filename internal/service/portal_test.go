package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"golang.org/x/crypto/bcrypt"
)

func TestPasswordHashing(t *testing.T) {
	t.Run("bcrypt generates valid hash", func(t *testing.T) {
		password := "testpassword123"
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)

		assert.NoError(t, err)
		assert.NotEmpty(t, hash)
		assert.NotEqual(t, password, string(hash))
	})

	t.Run("bcrypt verifies correct password", func(t *testing.T) {
		password := "testpassword123"
		hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)

		err := bcrypt.CompareHashAndPassword(hash, []byte(password))
		assert.NoError(t, err)
	})

	t.Run("bcrypt rejects incorrect password", func(t *testing.T) {
		password := "testpassword123"
		hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)

		err := bcrypt.CompareHashAndPassword(hash, []byte("wrongpassword"))
		assert.Error(t, err)
	})

	t.Run("same password generates different hashes", func(t *testing.T) {
		password := "testpassword123"
		hash1, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		hash2, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)

		assert.NotEqual(t, hash1, hash2)
	})
}

func TestErrorTypes(t *testing.T) {
	t.Run("ErrEmailExists is defined", func(t *testing.T) {
		assert.NotNil(t, ErrEmailExists)
		assert.Equal(t, "email already exists", ErrEmailExists.Error())
	})

	t.Run("ErrInvalidCredentials is defined", func(t *testing.T) {
		assert.NotNil(t, ErrInvalidCredentials)
		assert.Equal(t, "invalid email or password", ErrInvalidCredentials.Error())
	})
}
