package controllers

import (
	"net/http"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
)

func LikeArticle(c *gin.Context) {
	articleID := c.Param("id")

	likeKey := "article:" + articleID + ":likes"

	newCount, err := global.RedisDB.Incr(c, likeKey).Result()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"likes": newCount})
}

func GetArticleLikes(c *gin.Context) {
	articleID := c.Param("id")

	likeKey := "article:" + articleID + ":likes"

	count, err := global.RedisDB.Get(c, likeKey).Int64()
	if err == redis.Nil {
		count = 0
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"likes": count})
}
